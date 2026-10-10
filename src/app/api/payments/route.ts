import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { monthQuerySchema, paymentSchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, readJson, round2, zodFieldErrors } from "@/lib/accounts/http";
import { notify } from "@/lib/accounts/alerts";
import { currentMonthKey, istDateKey, monthRange } from "@/lib/accounts/period";
import { recomputePaymentStatus } from "@/lib/order-status";

const formatINR = (n: number) =>
  n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

async function invoicesWithBalance() {
  const invoices = await db.invoice.findMany({
    include: {
      order: { select: { orderNo: true, buyer: { select: { name: true } } } },
      payments: { select: { amount: true } },
    },
    orderBy: { invoiceNo: "asc" },
  });
  return invoices.map(({ payments, order, ...inv }) => {
    const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
    return {
      ...inv,
      orderNo: order.orderNo,
      buyerName: order.buyer.name,
      paid,
      outstanding: round2(inv.total - paid),
    };
  });
}

// GET ?month=YYYY-MM → payments received that month, plus every invoice with
// its paid/outstanding balance (Invoice rows are Module 1's; read-only here).
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const monthParsed = monthQuerySchema.safeParse(req.nextUrl.searchParams.get("month") ?? undefined);
  if (!monthParsed.success) return fieldErrorResponse(zodFieldErrors(monthParsed.error));
  const month = monthParsed.data ?? currentMonthKey();
  const { start, end } = monthRange(month);

  const [payments, invoices] = await Promise.all([
    db.payment.findMany({
      where: { receivedAt: { gte: start, lt: end } },
      include: {
        invoice: { select: { invoiceNo: true, order: { select: { orderNo: true, buyer: { select: { name: true } } } } } },
      },
      orderBy: { receivedAt: "desc" },
    }),
    invoicesWithBalance(),
  ]);

  return NextResponse.json({
    month,
    payments: payments.map((p) => ({
      id: p.id,
      invoiceId: p.invoiceId,
      invoiceNo: p.invoice.invoiceNo,
      orderNo: p.invoice.order.orderNo,
      buyerName: p.invoice.order.buyer.name,
      amount: p.amount,
      mode: p.mode,
      receivedAt: p.receivedAt,
    })),
    invoices,
    totals: {
      receivedThisMonth: round2(payments.reduce((s, p) => s + p.amount, 0)),
      outstanding: round2(invoices.reduce((s, i) => s + Math.max(0, i.outstanding), 0)),
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = paymentSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { invoiceId, amount, mode, receivedAt, clientMutationId } = parsed.data;

  // Idempotency: a double-click or a retried offline-queue submission with
  // the same clientMutationId returns the payment already recorded instead
  // of recording the same money twice.
  if (clientMutationId) {
    const existing = await db.payment.findUnique({
      where: { id: clientMutationId },
      include: { invoice: { include: { payments: { select: { amount: true } } } } },
    });
    if (existing) {
      const paidSoFar = existing.invoice.payments.reduce((s, p) => s + p.amount, 0);
      return NextResponse.json(
        { payment: existing, outstanding: round2(existing.invoice.total - paidSoFar) },
        { status: 200 },
      );
    }
  }

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: { select: { amount: true } }, order: { select: { orderNo: true, buyer: { select: { name: true } } } } },
  });
  if (!invoice) return fieldErrorResponse({ invoiceId: ["Invoice not found"] });

  const paid = invoice.payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = round2(invoice.total - paid);
  if (outstanding <= 0) {
    return fieldErrorResponse({ invoiceId: [`${invoice.invoiceNo} is already fully paid`] });
  }
  if (amount > outstanding + 0.005) {
    return fieldErrorResponse({ amount: [`Only ${formatINR(outstanding)} is outstanding on ${invoice.invoiceNo}`] });
  }
  if (istDateKey(receivedAt) < istDateKey(invoice.createdAt)) {
    return fieldErrorResponse({ receivedAt: ["Payment can't be received before the invoice date"] });
  }

  // A date-only entry for today keeps the current time so the audit trail and
  // ordering stay meaningful; a back-dated entry is stored at noon IST.
  const at = istDateKey(receivedAt) === istDateKey(new Date())
    ? new Date()
    : new Date(`${istDateKey(receivedAt)}T12:00:00+05:30`);

  // Insert, then re-check the balance inside the same transaction so two
  // payments saved at once can't together overpay the invoice.
  let payment;
  try {
    payment = await db.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: { id: clientMutationId || undefined, invoiceId, amount, mode, receivedAt: at },
      });
      const sum = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
      if ((sum._sum.amount ?? 0) > invoice.total + 0.005) throw new Error("OVERPAID");
      await recomputePaymentStatus(tx, invoice.orderId);
      return created;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "OVERPAID") {
      return fieldErrorResponse({ amount: ["Another payment was just recorded on this invoice; refresh and check the balance"] }, 409);
    }
    throw e;
  }
  await logAudit("Payment", payment.id, "create", null, payment, user.id);

  const remaining = round2(outstanding - amount);
  await notify(
    "payment_received",
    `${formatINR(amount)} received from ${invoice.order.buyer.name} against ${invoice.invoiceNo} (${invoice.order.orderNo}) by ${mode.toUpperCase()}. ${
      remaining > 0 ? `${formatINR(remaining)} still outstanding.` : "Invoice fully paid."
    }`,
    "info",
  );

  return NextResponse.json({ payment, outstanding: remaining }, { status: 201 });
}
