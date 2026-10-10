import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { paymentReversalSchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, notFound, readJson, round2, zodFieldErrors } from "@/lib/accounts/http";
import { istDateKey, receivedInstant } from "@/lib/accounts/period";
import { inr } from "@/lib/accounts/format";
import { postLedgerEntry } from "@/lib/ledger";
import { recomputePaymentStatus } from "@/lib/order-status";
import { AlreadyReversed, notReversed, reverseRecord } from "@/lib/reversals";
import { emit, emitDataChanged, RealtimeEvents } from "@/lib/realtime";

type Ctx = { params: Promise<{ id: string }> };

class PaymentRefused extends Error {
  constructor(
    public field: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// POST { reason, correction?: { amount, mode, receivedAt } } — owner only.
// The payment row and its ledger entry stay; a Reversal marks it void and a
// reversing ledger entry nets it out. With a correction, the right payment is
// recorded against the same invoice in the same transaction (still bounded by
// what is outstanding once the wrong one no longer counts).
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = paymentReversalSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { reason, correction } = parsed.data;

  let result;
  try {
    result = await writeTransaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id }, include: { invoice: { include: { reversal: { select: { id: true } } } } } });
      if (!payment) return null;
      const { invoice } = payment;
      if (invoice.reversal) throw new PaymentRefused("_form", `${invoice.invoiceNo} was cancelled after this payment`, 409);

      let replacement = null;
      if (correction) {
        if (istDateKey(correction.receivedAt) < istDateKey(invoice.createdAt)) {
          throw new PaymentRefused("correction.receivedAt", "Payment can't be received before the invoice date");
        }
        const others = await tx.payment.aggregate({ where: { invoiceId: invoice.id, ...notReversed, NOT: { id } }, _sum: { amount: true } });
        const outstanding = round2(invoice.total - (others._sum.amount ?? 0));
        if (correction.amount > outstanding + 0.005) {
          throw new PaymentRefused("correction.amount", `Only ${inr(outstanding, { decimals: true })} is outstanding on ${invoice.invoiceNo}`);
        }
        const at = receivedInstant(correction.receivedAt);
        replacement = await tx.payment.create({
          data: { invoiceId: invoice.id, amount: correction.amount, mode: correction.mode, receivedAt: at },
        });
        await postLedgerEntry(tx, {
          date: at,
          type: "payment_received",
          amount: replacement.amount,
          sourceType: "Payment",
          sourceId: replacement.id,
          orderId: invoice.orderId,
        });
      }
      const reversal = await reverseRecord(tx, { source: "Payment", id, reason, userId: user.id, replacementId: replacement?.id });
      const paymentStatus = await recomputePaymentStatus(tx, invoice.orderId);
      const { invoice: _invoice, ...original } = payment;
      void _invoice;
      return { original, reversal, replacement, paymentStatus, orderId: invoice.orderId };
    });
  } catch (e) {
    if (e instanceof AlreadyReversed) return fieldErrorResponse({ _form: ["This payment was already reversed"] }, 409);
    if (e instanceof PaymentRefused) return fieldErrorResponse({ [e.field]: [e.message] }, e.status);
    throw e;
  }
  if (!result) return notFound("Payment not found");

  await logAudit("Payment", id, "reverse", result.original, { reason, replacementId: result.replacement?.id ?? null }, user.id);
  if (result.replacement) {
    await logAudit("Payment", result.replacement.id, "create", null, { ...result.replacement, corrects: id }, user.id);
  }
  if (result.paymentStatus.from !== result.paymentStatus.to) {
    await logAudit("Order", result.orderId, "payment_status_change", { paymentStatus: result.paymentStatus.from }, { paymentStatus: result.paymentStatus.to }, user.id);
    emit(RealtimeEvents.OrderStatus, { orderId: result.orderId, paymentStatus: result.paymentStatus.to });
  }
  emitDataChanged({ entity: "Payment", id, action: "reverse" });
  return NextResponse.json({ reversal: result.reversal, replacement: result.replacement }, { status: 201 });
}
