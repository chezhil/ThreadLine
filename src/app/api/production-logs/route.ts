import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { productionLogSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { refreshProductionAlerts } from "@/lib/production/insights";

export async function POST(request: Request) {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const parsed = productionLogSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const input = parsed.data;
  try {
    const result = await db.$transaction(async (tx) => {
      const workOrder = await tx.workOrder.findUnique({ where: { id: input.workOrderId }, include: { machine: true, order: true } });
      if (!workOrder) throw new EntryError("workOrderId", "Work order not found");
      if (workOrder.status === "COMPLETED") throw new EntryError("workOrderId", "Work order is complete");
      if (workOrder.machine.status !== "RUNNING") throw new EntryError("workOrderId", "Set the machine to RUNNING before logging output");
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
      let orderToQc = false;
      if (completed && workOrder.order.status === "IN_PRODUCTION") {
        const stages = await tx.workOrder.findMany({ where: { orderId: workOrder.orderId }, select: { stage: true, status: true } });
        const allDone = ["spinning", "weaving", "dyeing"].every((stage) => stages.some((row) => row.stage === stage && row.status === "COMPLETED"));
        if (allDone) {
          await tx.order.update({ where: { id: workOrder.orderId }, data: { status: "QC" } });
          orderToQc = true;
        }
      }
      return { log, workOrder, nextQty, completed, orderToQc };
    });
    await logAudit("ProductionLog", result.log.id, "CREATE", null, result.log, actor.user.id);
    await logAudit("WorkOrder", result.workOrder.id, "PROGRESS", String(result.workOrder.producedQty), String(result.nextQty), actor.user.id);
    if (result.orderToQc) {
      await logAudit("Order", result.workOrder.orderId, "STATUS_CHANGE", "IN_PRODUCTION", "QC", actor.user.id);
      await emit("order:status", { orderId: result.workOrder.orderId, status: "QC" });
    }
    await emit("machine:status", { machineId: result.workOrder.machineId, status: result.workOrder.machine.status, outputChanged: true });
    await refreshProductionAlerts(db);
    return NextResponse.json({ ...result.log, producedQty: result.nextQty, completed: result.completed }, { status: 201 });
  } catch (error) {
    if (error instanceof EntryError) return problem(error.message, 400, error.field);
    throw error;
  }
}

class EntryError extends Error {
  constructor(public field: string, message: string) { super(message); }
}
