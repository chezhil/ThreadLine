// Single source of truth for Order status. The legacy `status` column
// (NEW|CONFIRMED|IN_PRODUCTION|QC|READY|DISPATCHED|CLOSED) stays as a
// derived display value so every existing reader keeps working — only
// `applyConfirm` (NEW->CONFIRMED) and `applyClose` (DISPATCHED->CLOSED) set
// it directly, driven by an explicit owner action. Everything in between is
// computed from the four granular fields below, each owned by the module
// that actually knows the real-world event: production creates work orders
// and logs output, quality inspects rolls, dispatch loads trucks, accounts
// records payments.
//
// Previously, `order.status` was written directly in three different places
// (the manual PATCH endpoint, work-orders/route.ts, production-logs/
// route.ts) with no shared validation — which is how an owner could
// manually "Advance" an order straight to READY or DISPATCHED from the UI
// with zero rolls actually produced, inspected, or shipped. That manual path
// is removed below; IN_PRODUCTION/QC/READY/DISPATCHED are now only ever
// reachable through the real event that earns them.
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";
import { logAudit } from "./audit";
import { emit, RealtimeEvents } from "./realtime";
import { ORDER_STATUSES, type OrderStatus } from "./tokens";

export { ORDER_STATUSES, type OrderStatus };

type Db = PrismaClient | Prisma.TransactionClient;

export const PRODUCTION_STATUSES = ["NOT_STARTED", "IN_PRODUCTION", "DONE"] as const;
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number];

export const ORDER_QC_STATUSES = ["PENDING", "PASS", "NEEDS_REWORK"] as const;
export type OrderQcStatus = (typeof ORDER_QC_STATUSES)[number];

export const DISPATCH_STATUSES = ["NOT_DISPATCHED", "PARTIALLY_DISPATCHED", "FULLY_DISPATCHED"] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface GranularStatus {
  productionStatus: ProductionStatus;
  qcStatus: OrderQcStatus;
  dispatchStatus: DispatchStatus;
}

/** Pure function: the legacy coarse status implied by the granular fields,
 * given what it currently is (needed because NEW/CONFIRMED/CLOSED have no
 * granular signal of their own — they're purely administrative). */
export function deriveStatus(current: string, g: GranularStatus): OrderStatus {
  if (current === "CLOSED") return "CLOSED"; // terminal, only applyClose leaves it
  if (g.dispatchStatus === "FULLY_DISPATCHED") return "DISPATCHED";
  if (g.productionStatus === "DONE" && g.qcStatus === "PASS") return "READY";
  if (g.productionStatus === "DONE") return "QC";
  if (g.productionStatus === "IN_PRODUCTION") return "IN_PRODUCTION";
  return current === "CONFIRMED" ? "CONFIRMED" : "NEW";
}

async function applyDerived(tx: Db, orderId: string, patch: Partial<GranularStatus>) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const next: GranularStatus = {
    productionStatus: (patch.productionStatus ?? order.productionStatus) as ProductionStatus,
    qcStatus: (patch.qcStatus ?? order.qcStatus) as OrderQcStatus,
    dispatchStatus: (patch.dispatchStatus ?? order.dispatchStatus) as DispatchStatus,
  };
  const nextStatus = deriveStatus(order.status, next);
  const updated = await tx.order.update({
    where: { id: orderId },
    data: { ...patch, status: nextStatus },
  });
  return { from: order.status as OrderStatus, to: nextStatus, order: updated };
}

/** Call when the first work order for an order is created. */
export async function applyProductionStarted(tx: Db, orderId: string) {
  return applyDerived(tx, orderId, { productionStatus: "IN_PRODUCTION" });
}

/** Call when every stage's work order reaches COMPLETED. */
export async function applyProductionCompleted(tx: Db, orderId: string) {
  return applyDerived(tx, orderId, { productionStatus: "DONE" });
}

/** Derives productionStatus from this order's WorkOrder rows. The live app
 * never calls this — it uses the real events (applyProductionStarted/
 * applyProductionCompleted) at the moment they happen. This exists for data
 * that was written directly (seed scripts), which has no such moment to hook. */
export async function recomputeProductionStatus(tx: Db, orderId: string) {
  const workOrders = await tx.workOrder.findMany({ where: { orderId }, select: { stage: true, status: true } });
  let productionStatus: ProductionStatus;
  if (workOrders.length === 0) {
    productionStatus = "NOT_STARTED";
  } else if (["spinning", "weaving", "dyeing"].every((s) => workOrders.some((w) => w.stage === s && w.status === "COMPLETED"))) {
    productionStatus = "DONE";
  } else {
    productionStatus = "IN_PRODUCTION";
  }
  return applyDerived(tx, orderId, { productionStatus });
}

/** Recomputes order-level QC status from this order's Roll.qcStatus rows.
 * PENDING if nothing's been inspected yet or anything still is; NEEDS_REWORK
 * if any roll is REWORK (actionable — blocks READY); PASS once at least one
 * roll has passed and none are PENDING/REWORK (REJECT rolls don't block —
 * they simply never ship, same as the dispatch-eligibility rule elsewhere). */
export async function recomputeQcStatus(tx: Db, orderId: string) {
  const rolls = await tx.roll.findMany({ where: { orderId }, select: { qcStatus: true } });
  let qcStatus: OrderQcStatus;
  if (rolls.length === 0 || rolls.some((r) => r.qcStatus === "PENDING")) {
    qcStatus = "PENDING";
  } else if (rolls.some((r) => r.qcStatus === "REWORK")) {
    qcStatus = "NEEDS_REWORK";
  } else if (rolls.some((r) => r.qcStatus === "PASS")) {
    qcStatus = "PASS";
  } else {
    qcStatus = "NEEDS_REWORK"; // every roll REJECT — nothing shippable, needs attention
  }
  return applyDerived(tx, orderId, { qcStatus });
}

/** Recomputes dispatch status from this order's Roll rows: FULLY_DISPATCHED
 * once no non-rejected roll is left undispatched (the same condition the
 * dispatch route already used to flip legacy `status` to DISPATCHED),
 * PARTIALLY_DISPATCHED once at least one has shipped but others haven't. */
export async function recomputeDispatchStatus(tx: Db, orderId: string) {
  const rolls = await tx.roll.findMany({ where: { orderId }, select: { dispatchId: true, qcStatus: true } });
  const dispatched = rolls.filter((r) => r.dispatchId !== null).length;
  const remainingShippable = rolls.filter((r) => r.dispatchId === null && r.qcStatus !== "REJECT").length;
  let dispatchStatus: DispatchStatus;
  if (dispatched === 0) dispatchStatus = "NOT_DISPATCHED";
  else if (remainingShippable === 0) dispatchStatus = "FULLY_DISPATCHED";
  else dispatchStatus = "PARTIALLY_DISPATCHED";
  return applyDerived(tx, orderId, { dispatchStatus });
}

/** Recomputes payment status from the sum of Payment rows across all of this
 * order's Invoice rows vs. their combined total. Independent of `status` —
 * an order can be fully DISPATCHED and still UNPAID. */
export async function recomputePaymentStatus(tx: Db, orderId: string): Promise<PaymentStatus> {
  const invoices = await tx.invoice.findMany({
    where: { orderId },
    include: { payments: { select: { amount: true } } },
  });
  const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
  const totalPaid = invoices.reduce((s, i) => s + i.payments.reduce((p, pay) => p + pay.amount, 0), 0);
  let paymentStatus: PaymentStatus;
  if (totalInvoiced === 0 || totalPaid <= 0) paymentStatus = "UNPAID";
  else if (totalPaid + 0.005 >= totalInvoiced) paymentStatus = "PAID";
  else paymentStatus = "PARTIAL";
  await tx.order.update({ where: { id: orderId }, data: { paymentStatus } });
  return paymentStatus;
}

/** The only remaining manual transition at the start: owner accepts the order. */
export async function applyConfirm(orderId: string, userId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "NEW") throw new InvalidTransition(`Cannot confirm from ${order.status}`);
  const updated = await db.order.update({ where: { id: orderId }, data: { status: "CONFIRMED" } });
  await logAudit("Order", orderId, "status_change", { status: "NEW" }, { status: "CONFIRMED" }, userId);
  emit(RealtimeEvents.OrderStatus, { orderId, status: "CONFIRMED" });
  return updated;
}

/** The only remaining manual transition at the end: owner closes the order
 * once it has fully shipped. Payment isn't a precondition — an owner may
 * close out a shipped order they've written off, or are still chasing
 * payment on outside the system's lifecycle. */
export async function applyClose(orderId: string, userId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "DISPATCHED") {
    throw new InvalidTransition(`Cannot close from ${order.status} — the order must be fully dispatched first`);
  }
  const updated = await db.order.update({ where: { id: orderId }, data: { status: "CLOSED" } });
  await logAudit("Order", orderId, "status_change", { status: "DISPATCHED" }, { status: "CLOSED" }, userId);
  emit(RealtimeEvents.OrderStatus, { orderId, status: "CLOSED" });
  return updated;
}

export class InvalidTransition extends Error {}
