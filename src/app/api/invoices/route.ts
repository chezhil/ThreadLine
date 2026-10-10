import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { generateInvoiceNo } from "@/lib/order-numbers";
import { computeInvoiceTotals } from "@/lib/billing";
import { logAudit } from "@/lib/audit";

const createInvoiceSchema = z.object({
  orderId: z.string().min(1),
});

// Additive route — only GET /api/invoices/:id is in the fixed contract, but
// something has to create the invoice. This is that something: Module 3
// (Dispatch) calls this with the order id and stores the returned invoice's id
// on its own Dispatch row, rather than computing GST itself.
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

  const subtotal = order.qtyMetres * order.pricePerMetre;
  const { gst, total } = computeInvoiceTotals(subtotal);
  const invoiceNo = await generateInvoiceNo();

  const invoice = await db.invoice.create({
    data: {
      invoiceNo,
      orderId: order.id,
      buyerId: order.buyerId,
      subtotal,
      gst,
      total,
      status: "ISSUED",
    },
  });

  await logAudit("Invoice", invoice.id, "create", null, invoice, user.id);

  return NextResponse.json({ invoice }, { status: 201 });
}
