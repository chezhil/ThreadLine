import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { workOrderSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { refreshProductionAlerts } from "@/lib/production/insights";
import { applyProductionStarted, recordStatusChanges } from "@/lib/order-status";
import { parsePageParams } from "@/lib/pagination";
import type { Prisma } from "@prisma/client";

const machineTypeForStage = { spinning: "spinning", weaving: "loom", dyeing: "dyeing" } as const;
const previousStage = { spinning: null, weaving: "spinning", dyeing: "weaving" } as const;

export async function GET(request: Request) {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  // Opt-in paging (see lib/pagination.ts): `?page=` with optional `search`
  // (order no or machine) and `status`. The work-orders page uses it — the
  // full list ran past a thousand rows — and then also gets the open work
  // orders on their own for its "record output" dropdown.
  const { searchParams } = new URL(request.url);
  const { paginated, page, pageSize, skip, take } = parsePageParams(searchParams);
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status");
  const where: Prisma.WorkOrderWhereInput = {
    ...(status && ["PLANNED", "IN_PROGRESS", "COMPLETED"].includes(status) ? { status } : {}),
    ...(search
      ? { OR: [{ order: { orderNo: { contains: search, mode: "insensitive" } } }, { machine: { name: { contains: search, mode: "insensitive" } } }] }
      : {}),
  };
  const [workOrders, orders, machines, total, activeWorkOrders] = await Promise.all([
    db.workOrder.findMany({
      where,
      include: {
        order: { select: { orderNo: true, status: true } },
        machine: { select: { id: true, name: true, status: true } },
        _count: { select: { productionLogs: true, rolls: true } },
      },
      orderBy: { startedAt: "desc" },
      ...(paginated ? { skip, take } : {}),
    }),
    db.order.findMany({
      where: { status: { not: "CLOSED" }, OR: [{ status: "CONFIRMED" }, { productionStatus: "IN_PRODUCTION" }] },
      select: { id: true, orderNo: true, status: true, qtyMetres: true },
    }),
    db.machine.findMany({ select: { id: true, name: true, type: true, status: true } }),
    paginated ? db.workOrder.count({ where }) : null,
    paginated
      ? db.workOrder.findMany({
          where: { status: { not: "COMPLETED" } },
          select: { id: true, stage: true, order: { select: { orderNo: true } }, machine: { select: { name: true } } },
          orderBy: { startedAt: "desc" },
        })
      : null,
  ]);
  if (!paginated) return NextResponse.json({ workOrders, orders, machines });
  return NextResponse.json({ workOrders, orders, machines, activeWorkOrders, total, page, pageSize });
}

export async function POST(request: Request) {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const parsed = workOrderSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const input = parsed.data;
  try {
    const result = await writeTransaction(async (tx) => {
      const [order, machine] = await Promise.all([
        tx.order.findUnique({ where: { id: input.orderId }, include: { reservations: true, workOrders: true } }),
        tx.machine.findUnique({ where: { id: input.machineId } }),
      ]);
      if (!order) throw new ProductionError("orderId", "Order not found");
      if (!machine) throw new ProductionError("machineId", "Machine not found");
      if (machine.type !== machineTypeForStage[input.stage]) throw new ProductionError("machineId", "Machine type does not match this stage");
      if (machine.status === "BREAKDOWN" || machine.status === "MAINTENANCE") {
        throw new ProductionError("machineId", `${machine.name} is under ${machine.status.toLowerCase()}; pick another machine`);
      }
      // productionStatus, not the legacy status: an order that has shipped a
      // first part-load (PARTIALLY_DISPATCHED) is still in production.
      if (order.status === "CLOSED" || !(order.status === "CONFIRMED" || order.productionStatus === "IN_PRODUCTION")) {
        throw new ProductionError("orderId", "Order is not ready for production");
      }
      // Some wastage allowance, but not an arbitrary amount more than ordered.
      if (input.plannedQty > order.qtyMetres * 1.1 + 0.000001) {
        throw new ProductionError("plannedQty", `Plan at most ${Math.floor(order.qtyMetres * 1.1)} m (order is ${order.qtyMetres} m plus 10% allowance)`);
      }
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
      const statusChange = order.productionStatus === "NOT_STARTED" ? await applyProductionStarted(tx, order.id) : null;
      return { workOrder, statusChange, orderNo: order.orderNo };
    });
    try {
      await logAudit("WorkOrder", result.workOrder.id, "CREATE", null, result.workOrder, actor.user.id);
      await recordStatusChanges([result.statusChange], actor.user.id);
      await emit("machine:status", { machineId: input.machineId, workOrderId: result.workOrder.id, assignmentChanged: true });
      await refreshProductionAlerts(db);
    } catch (sideEffectError) {
      console.error("Work order saved; follow-up step failed:", sideEffectError);
    }
    return NextResponse.json(result.workOrder, { status: 201 });
  } catch (error) {
    if (error instanceof ProductionError) return problem(error.message, 400, error.field);
    throw error;
  }
}

class ProductionError extends Error {
  constructor(public field: string, message: string) { super(message); }
}
