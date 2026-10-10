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
  // DISPATCHED means the whole order has left the mill: everything shippable
  // is on a truck AND production is finished (a part-shipment made while
  // dyeing is still running is not the end of the order).
  if (g.dispatchStatus === "FULLY_DISPATCHED" && g.productionStatus === "DONE") return "DISPATCHED";
  // READY needs at least one roll that can actually ship (qcStatus PASS).
  // Leftover REWORK rolls don't hold the order back (recomputeQcStatus
  // already reports PASS for that case); an order whose rolls are all
  // REWORK/REJECT stays in QC — there is nothing to load on a truck.
  if (g.productionStatus === "DONE" && g.qcStatus === "PASS") return "READY";
  if (g.productionStatus === "DONE") return "QC";
  if (g.productionStatus === "IN_PRODUCTION") return "IN_PRODUCTION";
  return current === "CONFIRMED" ? "CONFIRMED" : "NEW";
}

export interface StatusChange {
  orderId: string;
  from: OrderStatus;
  to: OrderStatus;
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
  return { orderId, from: order.status as OrderStatus, to: nextStatus, order: updated };
}

/** Audit-logs and broadcasts each legacy-status change the event helpers
 * returned. Call after the transaction commits, never inside it. */
export async function recordStatusChanges(changes: (StatusChange | null | undefined)[], userId: string) {
  const seen = new Set<string>();
  for (const c of changes) {
    if (!c || c.from === c.to) continue;
    const key = `${c.orderId}:${c.from}:${c.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await logAudit("Order", c.orderId, "status_change", { status: c.from }, { status: c.to }, userId);
    emit(RealtimeEvents.OrderStatus, { orderId: c.orderId, status: c.to });
  }
}

/** Folds a sequence of changes on one order into one from→to. */
export function netChange(changes: StatusChange[]): StatusChange | null {
  if (!changes.length) return null;
  return { orderId: changes[0].orderId, from: changes[0].from, to: changes[changes.length - 1].to };
}

/** Call when the first work order for an order is created. */
export async function applyProductionStarted(tx: Db, orderId: string) {
  return applyDerived(tx, orderId, { productionStatus: "IN_PRODUCTION" });
}

/** Call when the final stage (dyeing) completes and every work order for the
 * order is COMPLETED. Also re-derives dispatchStatus, which can only reach
 * FULLY_DISPATCHED once production is done. */
export async function applyProductionCompleted(tx: Db, orderId: string) {
  const dispatchStatus = await dispatchStatusFromRolls(tx, orderId, "DONE");
  return applyDerived(tx, orderId, { productionStatus: "DONE", dispatchStatus });
}

/** The last stage of the spinning → weaving → dyeing route. */
export const FINAL_STAGE = "dyeing";

/** Derives productionStatus from this order's WorkOrder rows. The live app
 * never calls this — it uses the real events (applyProductionStarted/
 * applyProductionCompleted) at the moment they happen. This exists for data
 * that was written directly (seed scripts), which has no such moment to hook.
 * DONE needs every work order completed AND either the final stage among
 * them or rolls already made from it (seeded history that never had a
 * dyeing work order but clearly finished cloth); one completed spinning work
 * order on its own is not a finished order. */
export async function recomputeProductionStatus(tx: Db, orderId: string) {
  const workOrders = await tx.workOrder.findMany({ where: { orderId }, select: { stage: true, status: true } });
  let productionStatus: ProductionStatus;
  if (workOrders.length === 0) {
    productionStatus = "NOT_STARTED";
  } else if (workOrders.every((w) => w.status === "COMPLETED")) {
    const finalStageDone = workOrders.some((w) => w.stage === FINAL_STAGE);
    const rolls = finalStageDone ? 0 : await tx.roll.count({ where: { orderId } });
    productionStatus = finalStageDone || rolls > 0 ? "DONE" : "IN_PRODUCTION";
  } else {
    productionStatus = "IN_PRODUCTION";
  }
  const dispatchStatus = await dispatchStatusFromRolls(tx, orderId, productionStatus);
  return applyDerived(tx, orderId, { productionStatus, dispatchStatus });
}

/** Recomputes order-level QC status from this order's Roll.qcStatus rows.
 * PENDING if nothing's been inspected yet or anything still is; PASS once at
 * least one roll has passed and none are PENDING — leftover REWORK rolls
 * don't block (the passed rolls can ship now, reworked ones follow later)
 * and REJECT rolls never ship; NEEDS_REWORK when no roll has passed (all
 * REWORK and/or REJECT), i.e. nothing is shippable and someone must act. */
export async function recomputeQcStatus(tx: Db, orderId: string) {
  const rolls = await tx.roll.findMany({ where: { orderId }, select: { qcStatus: true } });
  let qcStatus: OrderQcStatus;
  if (rolls.length === 0 || rolls.some((r) => r.qcStatus === "PENDING")) {
    qcStatus = "PENDING";
  } else if (rolls.some((r) => r.qcStatus === "PASS")) {
    qcStatus = "PASS";
  } else {
    qcStatus = "NEEDS_REWORK";
  }
  return applyDerived(tx, orderId, { qcStatus });
}

async function dispatchStatusFromRolls(tx: Db, orderId: string, productionStatus: string): Promise<DispatchStatus> {
  const rolls = await tx.roll.findMany({ where: { orderId }, select: { dispatchId: true, qcStatus: true } });
  const dispatched = rolls.filter((r) => r.dispatchId !== null).length;
  const remainingShippable = rolls.filter((r) => r.dispatchId === null && r.qcStatus !== "REJECT").length;
  if (dispatched === 0) return "NOT_DISPATCHED";
  if (remainingShippable === 0 && productionStatus === "DONE") return "FULLY_DISPATCHED";
  return "PARTIALLY_DISPATCHED";
}

/** Recomputes dispatch status from this order's Roll rows: FULLY_DISPATCHED
 * once production is done and no non-rejected roll is left undispatched,
 * PARTIALLY_DISPATCHED once at least one has shipped but the order isn't
 * finished (rolls left, or production still running and more to come). */
export async function recomputeDispatchStatus(tx: Db, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { productionStatus: true } });
  const dispatchStatus = await dispatchStatusFromRolls(tx, orderId, order.productionStatus);
  return applyDerived(tx, orderId, { dispatchStatus });
}

/** After a roll is minted or re-inspected: refresh both roll-derived
 * aggregates (a new PENDING roll re-opens QC and un-finishes dispatch). */
export async function recomputeRollAggregates(tx: Db, orderId: string): Promise<StatusChange | null> {
  const a = await recomputeQcStatus(tx, orderId);
  const b = await recomputeDispatchStatus(tx, orderId);
  return netChange([a, b]);
}

/** Recomputes payment status from each Invoice's GST-inclusive total (still
 * read off Invoice — that's invoice metadata, not a money-flow fact the
 * ledger classifies) vs. the ledger's `payment_received` entries for this
 * order (HARDENING_ADDENDUM.md item 3: one source of truth for how much has
 * actually been paid). A reversed payment keeps the same type with a negated
 * amount, so the sum nets out without special-casing reversesId.
 * Independent of `status` — an order can be fully DISPATCHED and still
 * UNPAID. Returns the change so the caller can audit/broadcast it. */
export async function recomputePaymentStatus(
  tx: Db,
  orderId: string,
): Promise<{ from: PaymentStatus; to: PaymentStatus }> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } });
  const invoices = await tx.invoice.findMany({ where: { orderId }, select: { total: true } });
  const totalInvoiced = invoices.reduce((s, i) => s + i.total, 0);
  const paidAgg = await tx.ledgerEntry.aggregate({
    where: { orderId, type: "payment_received" },
    _sum: { amount: true },
  });
  const totalPaid = paidAgg._sum.amount ?? 0;
  let paymentStatus: PaymentStatus;
  if (totalInvoiced === 0 || totalPaid <= 0) paymentStatus = "UNPAID";
  else if (totalPaid + 0.005 >= totalInvoiced) paymentStatus = "PAID";
  else paymentStatus = "PARTIAL";
  if (paymentStatus !== order.paymentStatus) {
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus } });
  }
  return { from: order.paymentStatus as PaymentStatus, to: paymentStatus };
}

/** The only remaining manual transition at the start: owner accepts the order. */
export async function applyConfirm(orderId: string, userId: string) {
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "NEW") throw new InvalidTransition(`Cannot confirm from ${order.status}`);
  // Conditional write: a double-click (or two owners) confirms once, the
  // second request gets the same "cannot confirm" as any other late caller.
  const { count } = await db.order.updateMany({ where: { id: orderId, status: "NEW" }, data: { status: "CONFIRMED" } });
  if (count !== 1) throw new InvalidTransition("Cannot confirm: the order was changed by someone else");
  const updated = await db.order.findUniqueOrThrow({ where: { id: orderId } });
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
  const { count } = await db.order.updateMany({ where: { id: orderId, status: "DISPATCHED" }, data: { status: "CLOSED" } });
  if (count !== 1) throw new InvalidTransition("Cannot close: the order was changed by someone else");
  const updated = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  await logAudit("Order", orderId, "status_change", { status: "DISPATCHED" }, { status: "CLOSED" }, userId);
  emit(RealtimeEvents.OrderStatus, { orderId, status: "CLOSED" });
  return updated;
}

export class InvalidTransition extends Error {}
