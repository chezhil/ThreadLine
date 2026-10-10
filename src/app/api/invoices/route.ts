import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { generateInvoiceNo } from "@/lib/order-numbers";
import { computeInvoiceTotals } from "@/lib/billing";
import { logAudit } from "@/lib/audit";
import { withRetry, writeTransaction } from "@/lib/concurrency";

const createInvoiceSchema = z.object({
  orderId: z.string().min(1),
});

// Additive route — only GET /api/invoices/:id is in the fixed contract, but
// something has to create the invoice. Called from the order detail page's
// "Generate GST invoice" button. One order gets at most one invoice — calling
// this twice (including two concurrent calls) returns the existing one
// rather than creating a duplicate.
export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const order = await db.order.findUnique({ where: { id: parsed.data.orderId } });
  if (!order) {
    return NextResponse.json({ fieldErrors: { orderId: ["Order not found"] } }, { status: 400 });
  }
  if (order.status === "NEW") {
    return NextResponse.json({ fieldErrors: { orderId: ["Confirm the order before invoicing it"] } }, { status: 400 });
  }

  // The invoice-number generator counts existing rows, so two concurrent
  // requests for the same (uninvoiced) order could both decide to create one.
  // The transaction makes one attempt atomic; withRetry re-attempts (with a
  // fresh find-or-create, not a stale one) if it still collides.
  const { invoice, created } = await withRetry(() =>
    writeTransaction(async (tx) => {
      const existing = await tx.invoice.findFirst({ where: { orderId: order.id } });
      if (existing) return { invoice: existing, created: false };

      const subtotal = order.qtyMetres * order.pricePerMetre;
      const { gst, total } = computeInvoiceTotals(subtotal);
      const invoiceNo = await generateInvoiceNo(tx);
      const invoice = await tx.invoice.create({
        data: { invoiceNo, orderId: order.id, buyerId: order.buyerId, subtotal, gst, total, status: "ISSUED" },
      });
      return { invoice, created: true };
    }),
  );

  if (created) await logAudit("Invoice", invoice.id, "create", null, invoice, user.id);

  return NextResponse.json({ invoice }, { status: created ? 201 : 200 });
}
