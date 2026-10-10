import { NextRequest, NextResponse } from "next/server";
import { withRetry, writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { invoiceReversalSchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { computeInvoiceTotals } from "@/lib/billing";
import { generateInvoiceNo } from "@/lib/order-numbers";
import { postLedgerEntry } from "@/lib/ledger";
import { recomputePaymentStatus } from "@/lib/order-status";
import { AlreadyReversed, notReversed, reverseRecord } from "@/lib/reversals";
import { describeCounts, inUse } from "@/lib/in-use";
import { emit, emitDataChanged, RealtimeEvents } from "@/lib/realtime";

type Ctx = { params: Promise<{ id: string }> };

class PaymentsOnInvoice extends Error {
  constructor(
    public invoiceNo: string,
    public payments: number,
  ) {
    super("payments recorded");
  }
}

// POST { reason, correction?: { pricePerMetre } } — owner only. Cancels an
// invoice with a credit note: the invoice row and its revenue entry stay, a
// Reversal marks it void and a reversing ledger entry nets the revenue out.
// With a correction the order is re-invoiced at the corrected price per metre
// (the order's price is corrected with it, so costing's revenue agrees) and
// any truck that carried the old invoice points at the new one. Payments
// already recorded against the invoice must be reversed first — they were
// money received against that document.
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = invoiceReversalSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { reason, correction } = parsed.data;

  let result;
  try {
    // generateInvoiceNo counts rows: retried from scratch on a numbering clash.
    result = await withRetry(() =>
      writeTransaction(async (tx) => {
        const invoice = await tx.invoice.findUnique({ where: { id }, include: { order: true } });
        if (!invoice) return null;
        const payments = await tx.payment.count({ where: { invoiceId: id, ...notReversed } });
        if (payments > 0) throw new PaymentsOnInvoice(invoice.invoiceNo, payments);

        let replacement = null;
        let order = invoice.order;
        if (correction) {
          order = await tx.order.update({ where: { id: order.id }, data: { pricePerMetre: correction.pricePerMetre } });
          const subtotal = order.qtyMetres * order.pricePerMetre;
          const { gst, total } = computeInvoiceTotals(subtotal);
          replacement = await tx.invoice.create({
            data: { invoiceNo: await generateInvoiceNo(tx), orderId: order.id, buyerId: order.buyerId, subtotal, gst, total, status: "ISSUED" },
          });
          await postLedgerEntry(tx, {
            date: replacement.createdAt,
            type: "revenue",
            amount: replacement.subtotal,
            sourceType: "Invoice",
            sourceId: replacement.id,
            orderId: order.id,
          });
          await tx.dispatch.updateMany({ where: { invoiceId: id }, data: { invoiceId: replacement.id } });
        }
        const reversal = await reverseRecord(tx, { source: "Invoice", id, reason, userId: user.id, replacementId: replacement?.id });
        const paymentStatus = await recomputePaymentStatus(tx, order.id);
        const { order: before, ...original } = invoice;
        return { original, reversal, replacement, paymentStatus, orderBefore: before, orderAfter: order };
      }),
    );
  } catch (e) {
    if (e instanceof AlreadyReversed) return fieldErrorResponse({ _form: ["This invoice was already reversed"] }, 409);
    if (e instanceof PaymentsOnInvoice) {
      return inUse(
        `${describeCounts([[e.payments, "payment"]])} ${e.payments === 1 ? "is" : "are"} recorded against ${e.invoiceNo}. Reverse ${e.payments === 1 ? "it" : "them"} first, then cancel the invoice.`,
      );
    }
    throw e;
  }
  if (!result) return notFound("Invoice not found");

  const orderId = result.orderAfter.id;
  await logAudit("Invoice", id, "reverse", result.original, { reason, replacementId: result.replacement?.id ?? null }, user.id);
  if (result.replacement) {
    await logAudit("Invoice", result.replacement.id, "create", null, { ...result.replacement, corrects: id }, user.id);
    await logAudit("Order", orderId, "update", { pricePerMetre: result.orderBefore.pricePerMetre }, { pricePerMetre: result.orderAfter.pricePerMetre }, user.id);
  }
  if (result.paymentStatus.from !== result.paymentStatus.to) {
    await logAudit("Order", orderId, "payment_status_change", { paymentStatus: result.paymentStatus.from }, { paymentStatus: result.paymentStatus.to }, user.id);
    emit(RealtimeEvents.OrderStatus, { orderId, paymentStatus: result.paymentStatus.to });
  }
  emitDataChanged({ entity: "Invoice", id, action: "reverse" });
  return NextResponse.json({ reversal: result.reversal, replacement: result.replacement }, { status: 201 });
}
