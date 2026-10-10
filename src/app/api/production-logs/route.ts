import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { productionIdSchema, productionLogSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { millDayRange, refreshProductionAlerts } from "@/lib/production/insights";
import { applyProductionCompleted, FINAL_STAGE, recordStatusChanges, type StatusChange } from "@/lib/order-status";

// GET ?workOrderId=… — that work order's output entries, newest first, with
// who logged each (by name), so a wrong entry can be found and corrected.
export async function GET(request: NextRequest) {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const workOrderId = request.nextUrl.searchParams.get("workOrderId");
  if (!productionIdSchema.safeParse(workOrderId).success) return problem("Pass a valid workOrderId", 400, "workOrderId");
  const logs = await db.productionLog.findMany({ where: { workOrderId: workOrderId! }, orderBy: { loggedAt: "desc" } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(logs.map((log) => log.loggedBy))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((user) => [user.id, user.name]));
  return NextResponse.json({
    logs: logs.map(({ loggedBy, ...log }) => ({ ...log, loggedByName: names.get(loggedBy) ?? "Unknown user" })),
  });
}

export async function POST(request: Request) {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const parsed = productionLogSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const input = parsed.data;
  try {
    const result = await writeTransaction(async (tx) => {
      const workOrder = await tx.workOrder.findUnique({ where: { id: input.workOrderId }, include: { machine: true, order: true } });
      if (!workOrder) throw new EntryError("workOrderId", "Work order not found");
      if (workOrder.status === "COMPLETED") throw new EntryError("workOrderId", "Work order is complete");
      if (workOrder.order.productionStatus !== "IN_PRODUCTION" || workOrder.order.status === "CLOSED") {
        throw new EntryError("workOrderId", "This order is not in production");
      }
      if (workOrder.machine.status !== "RUNNING") throw new EntryError("workOrderId", "Set the machine to RUNNING before logging output");
      // A machine can't make more than its rated output in one shift: bound
      // what is logged against it for this shift today (IST mill day).
      const { start, end } = millDayRange();
      const shiftSoFar = await tx.productionLog.aggregate({
        where: { machineId: workOrder.machineId, shift: input.shift, loggedAt: { gte: start, lt: end } },
        _sum: { qtyProduced: true },
      });
      const alreadyLogged = shiftSoFar._sum.qtyProduced ?? 0;
      if (alreadyLogged + input.qtyProduced > workOrder.machine.capacityMetresPerShift + 0.000001) {
        throw new EntryError(
          "qtyProduced",
          `${workOrder.machine.name} makes at most ${workOrder.machine.capacityMetresPerShift} m per shift` +
            (alreadyLogged ? `; ${alreadyLogged} m is already logged for ${input.shift} today` : ""),
        );
      }
      const nextQty = workOrder.producedQty + input.qtyProduced;
      if (nextQty > workOrder.plannedQty + 0.000001) throw new EntryError("qtyProduced", "Output exceeds planned metres");
      const completed = nextQty >= workOrder.plannedQty - 0.000001;
      const changed = await tx.workOrder.updateMany({
        where: { id: workOrder.id, producedQty: workOrder.producedQty },
        data: {
          producedQty: { increment: input.qtyProduced },
          status: completed ? "COMPLETED" : "IN_PROGRESS",
          startedAt: workOrder.startedAt ?? new Date(),
          finishedAt: completed ? new Date() : null,
        },
      });
      if (changed.count !== 1) throw new EntryError("qtyProduced", "Output changed while you were entering it; refresh and try again");
      const log = await tx.productionLog.create({
        data: { workOrderId: workOrder.id, machineId: workOrder.machineId, shift: input.shift, qtyProduced: input.qtyProduced, loggedBy: actor.user.id },
      });
      // Production is finished only when the last stage (dyeing) completes and
      // nothing else is still open — completing spinning first must not push
      // the order to QC (that used to block weaving from ever being created).
      let statusChange: StatusChange | null = null;
      if (completed && workOrder.stage === FINAL_STAGE) {
        const stages = await tx.workOrder.findMany({ where: { orderId: workOrder.orderId }, select: { stage: true, status: true } });
        if (stages.every((row) => row.status === "COMPLETED")) {
          statusChange = await applyProductionCompleted(tx, workOrder.orderId);
        }
      }
      return { log, workOrder, nextQty, completed, statusChange };
    });
    // The log is committed; a failure in audit/broadcast/alerts below must not
    // turn it into a 500 the supervisor would retry (double-counting output).
    try {
      await logAudit("ProductionLog", result.log.id, "CREATE", null, result.log, actor.user.id);
      await logAudit("WorkOrder", result.workOrder.id, "PROGRESS", String(result.workOrder.producedQty), String(result.nextQty), actor.user.id);
      await recordStatusChanges([result.statusChange], actor.user.id);
      await emit("machine:status", { machineId: result.workOrder.machineId, status: result.workOrder.machine.status, outputChanged: true });
      await refreshProductionAlerts(db);
    } catch (sideEffectError) {
      console.error("Production log saved; follow-up step failed:", sideEffectError);
    }
    return NextResponse.json({ ...result.log, producedQty: result.nextQty, completed: result.completed }, { status: 201 });
  } catch (error) {
    if (error instanceof EntryError) return problem(error.message, 400, error.field);
    throw error;
  }
}

class EntryError extends Error {
  constructor(public field: string, message: string) { super(message); }
}
