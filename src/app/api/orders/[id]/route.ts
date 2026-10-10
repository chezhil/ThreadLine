import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { orderStatusUpdateSchema, orderUpdateSchema, type OrderUpdateInput } from "@/lib/validation/order";
import { applyClose, applyConfirm, InvalidTransition } from "@/lib/order-status";
import { notReversed, reversalSummary } from "@/lib/reversals";
import { storedFeasibility, storedFeasibilityInputs } from "@/lib/feasibility";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { describeCounts, inUse } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string }> };

/** An order's details are a person's to change only before production starts. */
const EDITABLE_STATUSES = ["NEW", "CONFIRMED"];

export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      buyer: true,
      reservations: { include: { yarnLot: { include: { yarnType: true } } } },
      invoices: { include: { reversal: reversalSummary }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) return notFound("Not found");

  return NextResponse.json({ order });
}

// PATCH { status } — the only two manual moves: NEW→CONFIRMED and
// DISPATCHED→CLOSED. Everything in between (IN_PRODUCTION, QC, READY,
// DISPATCHED) is computed from real production/QC/dispatch events (see
// src/lib/order-status.ts) and can't be requested here: this endpoint used to
// accept any next status, so an owner could "Advance" an order to READY or
// DISPATCHED with nothing produced, inspected or shipped.
//
// PATCH { buyerId?, fabricType?, colour?, gsm?, qtyMetres?, pricePerMetre?,
// deadline?, yarnTypeId?, wastagePct? } — corrects the order's details while
// it is NEW or CONFIRMED (see editDetails).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const { id } = await params;
  const body = await readJson(req);
  if (body && typeof body === "object" && "status" in body) {
    if (Object.keys(body).length > 1) return fieldErrorResponse({ status: ["Change the status on its own, not with other fields"] });
    return changeStatus(id, body, user.id);
  }

  const parsed = orderUpdateSchema.safeParse(body);
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  return editDetails(id, parsed.data, user.id);
}

async function changeStatus(id: string, body: object, userId: string) {
  const parsed = orderStatusUpdateSchema.safeParse(body);
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const { status: to } = parsed.data;
  if (to !== "CONFIRMED" && to !== "CLOSED") {
    return fieldErrorResponse({
      status: [
        to === "IN_PRODUCTION"
          ? "IN_PRODUCTION is set automatically when production starts a work order, not set manually."
          : to === "QC"
            ? "QC is set automatically once every production stage completes, not set manually."
            : to === "READY"
              ? "READY is set automatically once QC passes, not set manually."
              : to === "DISPATCHED"
                ? "DISPATCHED is set automatically once every shippable roll has been dispatched, not set manually."
                : `Only CONFIRMED or CLOSED can be set here.`,
      ],
    });
  }

  const exists = await db.order.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Not found");

  try {
    const updated = to === "CONFIRMED" ? await applyConfirm(id, userId) : await applyClose(id, userId);
    return NextResponse.json({ order: updated });
  } catch (e) {
    if (e instanceof InvalidTransition) return fieldErrorResponse({ status: [e.message] });
    throw e;
  }
}

class EditRefused extends Error {
  constructor(
    public field: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

/**
 * Details can change only while the order is NEW or CONFIRMED (the update is
 * conditional on that, so it can't race a work order starting production).
 * Buyer, quantity and price are what an issued invoice billed, so they stay
 * fixed while the order has an active invoice. A change to what feasibility
 * depends on re-runs the check (with the yarn type it was checked against,
 * or a new one), or clears a verdict that no longer applies.
 */
async function editDetails(id: string, input: OrderUpdateInput, userId: string) {
  const { yarnTypeId: newYarnTypeId, wastagePct: newWastagePct, ...fields } = input;

  const current = await db.order.findUnique({ where: { id } });
  if (!current) return notFound("Not found");

  if (fields.buyerId && fields.buyerId !== current.buyerId) {
    const buyer = await db.buyer.findUnique({ where: { id: fields.buyerId } });
    if (!buyer) return fieldErrorResponse({ buyerId: ["Buyer not found"] });
    if (buyer.archivedAt) return fieldErrorResponse({ buyerId: ["This buyer is archived; restore it first"] });
  }
  if (newYarnTypeId) {
    const yarnType = await db.yarnType.findUnique({ where: { id: newYarnTypeId } });
    if (!yarnType) return fieldErrorResponse({ yarnTypeId: ["Yarn type not found"] });
    if (yarnType.archivedAt) return fieldErrorResponse({ yarnTypeId: ["This yarn type is archived; restore it first"] });
  }

  // Advisory, from current stock and machines — computed before the write.
  const feasibilityChanged =
    newYarnTypeId !== undefined ||
    newWastagePct !== undefined ||
    (fields.gsm !== undefined && fields.gsm !== current.gsm) ||
    (fields.qtyMetres !== undefined && fields.qtyMetres !== current.qtyMetres) ||
    (fields.deadline !== undefined && fields.deadline.getTime() !== current.deadline.getTime());
  let feasibilityResult = current.feasibilityResult;
  if (feasibilityChanged) {
    const previous = storedFeasibilityInputs(current.feasibilityResult);
    const yarnTypeId = newYarnTypeId ?? previous?.yarnTypeId;
    feasibilityResult = yarnTypeId
      ? await storedFeasibility({
          gsm: fields.gsm ?? current.gsm,
          qtyMetres: fields.qtyMetres ?? current.qtyMetres,
          deadline: fields.deadline ?? current.deadline,
          yarnTypeId,
          wastagePct: newWastagePct ?? previous?.wastagePct,
        })
      : null;
  }

  let after;
  try {
    after = await writeTransaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id } });
      if (!EDITABLE_STATUSES.includes(order.status)) {
        throw new EditRefused("_form", `${order.orderNo} is ${order.status.replace(/_/g, " ")}; its details can only change while it is NEW or CONFIRMED`);
      }
      const billedFieldChanged =
        (fields.buyerId !== undefined && fields.buyerId !== order.buyerId) ||
        (fields.qtyMetres !== undefined && fields.qtyMetres !== order.qtyMetres) ||
        (fields.pricePerMetre !== undefined && fields.pricePerMetre !== order.pricePerMetre);
      if (billedFieldChanged) {
        const invoice = await tx.invoice.findFirst({ where: { orderId: id, ...notReversed }, select: { invoiceNo: true } });
        if (invoice) {
          throw new EditRefused(
            "_form",
            `${invoice.invoiceNo} was issued for this order's buyer, quantity and price. Reverse it (Accounts → Payments) before changing them.`,
          );
        }
      }
      const { count } = await tx.order.updateMany({
        where: { id, status: { in: EDITABLE_STATUSES } },
        data: { ...fields, feasibilityResult },
      });
      if (count !== 1) throw new EditRefused("_form", "The order changed while you were editing it; reload and try again");
      return tx.order.findUniqueOrThrow({ where: { id } });
    });
  } catch (e) {
    if (e instanceof EditRefused) return fieldErrorResponse({ [e.field]: [e.message] }, e.status);
    throw e;
  }

  await logAudit("Order", id, "update", current, after, userId);
  emitDataChanged({ entity: "Order", id, action: "update" });
  return NextResponse.json({ order: after });
}

// Only an order nothing depends on yet can be deleted: NEW or CONFIRMED, no
// yarn reserved (release it first), no work, rolls, invoices, expenses or
// ledger entries, no yarn received against it.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const result = await writeTransaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id },
      include: { _count: { select: { reservations: true, workOrders: true, rolls: true, invoices: true } } },
    });
    if (!order) return { status: "missing" as const };
    if (!EDITABLE_STATUSES.includes(order.status)) return { status: "started" as const, order };
    const [expenses, ledgerEntries, linkedLots] = await Promise.all([
      tx.expense.count({ where: { orderId: id } }),
      tx.ledgerEntry.count({ where: { orderId: id } }),
      tx.yarnLot.count({ where: { linkedOrderId: id } }),
    ]);
    const dependents = describeCounts([
      [order._count.reservations, "yarn reservation"],
      [order._count.workOrders, "work order"],
      [order._count.rolls, "roll"],
      [order._count.invoices, "invoice"],
      [expenses, "expense"],
      [ledgerEntries, "ledger entry", "ledger entries"],
      [linkedLots, "yarn lot received against it", "yarn lots received against it"],
    ]);
    if (dependents) return { status: "in_use" as const, order, dependents };
    await tx.order.delete({ where: { id } });
    const { _count, ...snapshot } = order;
    void _count;
    return { status: "deleted" as const, snapshot };
  });
  if (result.status === "missing") return notFound("Not found");
  if (result.status === "started") {
    return inUse(`${result.order.orderNo} is ${result.order.status.replace(/_/g, " ")}; only a NEW or CONFIRMED order can be deleted.`);
  }
  if (result.status === "in_use") {
    const hint = result.order._count.reservations ? " Release its yarn reservations first." : "";
    return inUse(`${result.order.orderNo} has ${result.dependents}, so it can't be deleted.${hint}`);
  }

  await logAudit("Order", id, "delete", result.snapshot, null, user.id);
  emitDataChanged({ entity: "Order", id, action: "delete" });
  return NextResponse.json({ ok: true });
}
