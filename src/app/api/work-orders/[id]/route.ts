import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { productionIdSchema, workOrderUpdateSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { refreshProductionAlerts } from "@/lib/production/insights";
import { recordStatusChanges, syncProductionStatus } from "@/lib/order-status";
import { describeCounts } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string }> };

const machineTypeForStage: Record<string, string> = { spinning: "spinning", weaving: "loom", dyeing: "dyeing" };

class WorkOrderRefused extends Error {
  constructor(
    public field: string | undefined,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// PATCH { machineId?, plannedQty? } — move an unfinished work order to
// another machine (output already logged stays on the machine that made it)
// or re-plan its metres. The plan must stay above what is already produced:
// shrinking it to exactly that would finish the work order behind
// everyone's back.
export async function PATCH(request: Request, context: Ctx) {
  const { id } = await context.params;
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  if (!productionIdSchema.safeParse(id).success) return problem("Invalid work order identifier", 400, "id");
  const parsed = workOrderUpdateSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const input = parsed.data;

  let result;
  try {
    result = await writeTransaction(async (tx) => {
      const before = await tx.workOrder.findUnique({ where: { id }, include: { order: true } });
      if (!before) return null;
      if (before.status === "COMPLETED") {
        throw new WorkOrderRefused(undefined, "A completed work order can't be changed; correct its output entries instead", 409);
      }
      if (before.order.status === "CLOSED") throw new WorkOrderRefused(undefined, `${before.order.orderNo} is closed`, 409);
      if (input.machineId && input.machineId !== before.machineId) {
        const machine = await tx.machine.findUnique({ where: { id: input.machineId } });
        if (!machine) throw new WorkOrderRefused("machineId", "Machine not found");
        if (machine.type !== machineTypeForStage[before.stage]) throw new WorkOrderRefused("machineId", "Machine type does not match this stage");
        if (machine.status === "BREAKDOWN" || machine.status === "MAINTENANCE") {
          throw new WorkOrderRefused("machineId", `${machine.name} is under ${machine.status.toLowerCase()}; pick another machine`);
        }
        const busy = await tx.workOrder.findFirst({ where: { machineId: machine.id, status: { not: "COMPLETED" }, NOT: { id } } });
        if (busy) throw new WorkOrderRefused("machineId", "Machine already has an active work order");
      }
      if (input.plannedQty !== undefined) {
        if (input.plannedQty <= before.producedQty + 0.000001) {
          throw new WorkOrderRefused("plannedQty", `Plan more than the ${before.producedQty} m already produced`);
        }
        if (input.plannedQty > before.order.qtyMetres * 1.1 + 0.000001) {
          throw new WorkOrderRefused("plannedQty", `Plan at most ${Math.floor(before.order.qtyMetres * 1.1)} m (order is ${before.order.qtyMetres} m plus 10% allowance)`);
        }
      }
      // Conditional on the state read above: output logged in between makes
      // this a conflict instead of silently re-planning against stale figures.
      const changed = await tx.workOrder.updateMany({
        where: { id, status: before.status, producedQty: before.producedQty },
        data: input,
      });
      if (changed.count !== 1) throw new WorkOrderRefused(undefined, "The work order changed while you were editing it; refresh and try again", 409);
      const { order: _order, ...snapshot } = before;
      void _order;
      return { before: snapshot, after: await tx.workOrder.findUniqueOrThrow({ where: { id } }) };
    });
  } catch (error) {
    if (error instanceof WorkOrderRefused) return problem(error.message, error.status, error.field);
    throw error;
  }
  if (!result) return problem("Work order not found", 404);

  try {
    await logAudit("WorkOrder", id, "UPDATE", result.before, result.after, actor.user.id);
    for (const machineId of new Set([result.before.machineId, result.after.machineId])) {
      emit("machine:status", { machineId, workOrderId: id, assignmentChanged: true });
    }
    await refreshProductionAlerts(db);
  } catch (sideEffectError) {
    console.error("Work order updated; follow-up step failed:", sideEffectError);
  }
  return NextResponse.json(result.after);
}

// DELETE — only a work order nothing came out of yet (no output logged, no
// rolls). If it was the order's only one, the order goes back to CONFIRMED.
export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  if (!productionIdSchema.safeParse(id).success) return problem("Invalid work order identifier", 400, "id");

  const result = await writeTransaction(async (tx) => {
    const workOrder = await tx.workOrder.findUnique({
      where: { id },
      include: { _count: { select: { productionLogs: true, rolls: true } } },
    });
    if (!workOrder) return { status: "missing" as const };
    const dependents = describeCounts([
      [workOrder._count.productionLogs, "output entry", "output entries"],
      [workOrder._count.rolls, "roll"],
    ]);
    if (dependents) return { status: "in_use" as const, dependents };
    await tx.workOrder.delete({ where: { id } });
    const statusChange = await syncProductionStatus(tx, workOrder.orderId);
    const { _count, ...snapshot } = workOrder;
    void _count;
    return { status: "deleted" as const, snapshot, statusChange };
  });
  if (result.status === "missing") return problem("Work order not found", 404);
  if (result.status === "in_use") {
    return problem(`This work order has ${result.dependents}, so it can't be deleted. Correct those instead.`, 409);
  }

  try {
    await logAudit("WorkOrder", id, "DELETE", result.snapshot, null, actor.user.id);
    await recordStatusChanges([result.statusChange], actor.user.id);
    emit("machine:status", { machineId: result.snapshot.machineId, workOrderId: id, assignmentChanged: true });
    await refreshProductionAlerts(db);
  } catch (sideEffectError) {
    console.error("Work order deleted; follow-up step failed:", sideEffectError);
  }
  return NextResponse.json({ deleted: true });
}
