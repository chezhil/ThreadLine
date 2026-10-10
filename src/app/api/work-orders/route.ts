import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { workOrderSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { refreshProductionAlerts } from "@/lib/production/insights";

const machineTypeForStage = { spinning: "spinning", weaving: "loom", dyeing: "dyeing" } as const;
const previousStage = { spinning: null, weaving: "spinning", dyeing: "weaving" } as const;

export async function GET() {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const [workOrders, orders, machines] = await Promise.all([
    db.workOrder.findMany({
      include: { order: { select: { orderNo: true } }, machine: { select: { name: true, status: true } } },
      orderBy: { startedAt: "desc" },
    }),
    db.order.findMany({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION"] } }, select: { id: true, orderNo: true, status: true } }),
    db.machine.findMany({ select: { id: true, name: true, type: true, status: true } }),
  ]);
  return NextResponse.json({ workOrders, orders, machines });
}

export async function POST(request: Request) {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const parsed = workOrderSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const input = parsed.data;
  try {
    const result = await db.$transaction(async (tx) => {
      const [order, machine] = await Promise.all([
        tx.order.findUnique({ where: { id: input.orderId }, include: { reservations: true, workOrders: true } }),
        tx.machine.findUnique({ where: { id: input.machineId } }),
      ]);
      if (!order) throw new ProductionError("orderId", "Order not found");
      if (!machine) throw new ProductionError("machineId", "Machine not found");
      if (machine.type !== machineTypeForStage[input.stage]) throw new ProductionError("machineId", "Machine type does not match this stage");
      if (!["CONFIRMED", "IN_PRODUCTION"].includes(order.status)) throw new ProductionError("orderId", "Order is not ready for production");
      if (!order.reservations.length) throw new ProductionError("orderId", "Reserve yarn before starting production");
      if (order.workOrders.some((workOrder) => workOrder.stage === input.stage)) {
        throw new ProductionError("stage", "A work order already exists for this stage");
      }
      const prerequisite = previousStage[input.stage];
      if (prerequisite && !order.workOrders.some((workOrder) => workOrder.stage === prerequisite && workOrder.status === "COMPLETED")) {
        throw new ProductionError("stage", `Complete ${prerequisite} before starting ${input.stage}`);
      }
      const busy = await tx.workOrder.findFirst({ where: { machineId: machine.id, status: { not: "COMPLETED" } } });
      if (busy) throw new ProductionError("machineId", "Machine already has an active work order");
      const workOrder = await tx.workOrder.create({ data: { ...input, producedQty: 0, status: "PLANNED" } });
      const statusChanged = order.status === "CONFIRMED";
      if (statusChanged) await tx.order.update({ where: { id: order.id }, data: { status: "IN_PRODUCTION" } });
      return { workOrder, statusChanged, orderNo: order.orderNo };
    });
    await logAudit("WorkOrder", result.workOrder.id, "CREATE", null, result.workOrder, actor.user.id);
    if (result.statusChanged) {
      await logAudit("Order", input.orderId, "STATUS_CHANGE", "CONFIRMED", "IN_PRODUCTION", actor.user.id);
      await emit("order:status", { orderId: input.orderId, status: "IN_PRODUCTION" });
    }
    await emit("machine:status", { machineId: input.machineId, workOrderId: result.workOrder.id, assignmentChanged: true });
    await refreshProductionAlerts(db);
    return NextResponse.json(result.workOrder, { status: 201 });
  } catch (error) {
    if (error instanceof ProductionError) return problem(error.message, 400, error.field);
    throw error;
  }
}

class ProductionError extends Error {
  constructor(public field: string, message: string) { super(message); }
}
