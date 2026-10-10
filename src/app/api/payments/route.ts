import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { monthQuerySchema, paymentSchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, readJson, round2, zodFieldErrors } from "@/lib/accounts/http";
import { notify } from "@/lib/accounts/alerts";
import { currentMonthKey, istDateKey, monthRange } from "@/lib/accounts/period";
import { recomputePaymentStatus } from "@/lib/order-status";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { postLedgerEntry } from "@/lib/ledger";

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

type PaymentWithInvoice = Prisma.PaymentGetPayload<{
  include: { invoice: { include: { payments: { select: { amount: true } } } } };
}>;

/** The answer to a repeated clientMutationId: the payment already recorded,
 * or 409 when that id was used for a different invoice. */
function replayedPayment(existing: PaymentWithInvoice, invoiceId: string) {
  if (existing.invoiceId !== invoiceId) {
    return NextResponse.json({ error: "This payment id was already used for another invoice" }, { status: 409 });
  }
  const paidSoFar = existing.invoice.payments.reduce((s, p) => s + p.amount, 0);
  const { invoice: _invoice, ...payment } = existing;
  return NextResponse.json({ payment, outstanding: round2(existing.invoice.total - paidSoFar) }, { status: 200 });
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
    if (existing) return replayedPayment(existing, invoiceId);
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
  let saved;
  try {
    saved = await writeTransaction(async (tx) => {
      const created = await tx.payment.create({
        data: { id: clientMutationId || undefined, invoiceId, amount, mode, receivedAt: at },
      });
      const sum = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amount: true } });
      if ((sum._sum.amount ?? 0) > invoice.total + 0.005) throw new Error("OVERPAID");
      // Ledger entry before recomputePaymentStatus — that function sums
      // ledger rows, so it must see this payment's entry already posted.
      await postLedgerEntry(tx, {
        date: at,
        type: "payment_received",
        amount: created.amount,
        sourceType: "Payment",
        sourceId: created.id,
        orderId: invoice.orderId,
      });
      const paymentStatus = await recomputePaymentStatus(tx, invoice.orderId);
      return { created, paymentStatus };
    });
  } catch (e) {
    // The same clientMutationId sent twice at once: the second insert loses
    // the primary-key race. Answer with the payment the first one recorded.
    if (clientMutationId && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await db.payment.findUnique({
        where: { id: clientMutationId },
        include: { invoice: { include: { payments: { select: { amount: true } } } } },
      });
      if (existing) return replayedPayment(existing, invoiceId);
    }
    if (e instanceof Error && e.message === "OVERPAID") {
      return fieldErrorResponse({ amount: ["Another payment was just recorded on this invoice; refresh and check the balance"] }, 409);
    }
    throw e;
  }
  const payment = saved.created;
  await logAudit("Payment", payment.id, "create", null, payment, user.id);
  if (saved.paymentStatus.from !== saved.paymentStatus.to) {
    await logAudit(
      "Order",
      invoice.orderId,
      "payment_status_change",
      { paymentStatus: saved.paymentStatus.from },
      { paymentStatus: saved.paymentStatus.to },
      user.id,
    );
    emit(RealtimeEvents.OrderStatus, { orderId: invoice.orderId, paymentStatus: saved.paymentStatus.to });
  }

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
