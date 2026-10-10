import type { PrismaClient } from "@prisma/client";

// Database-wide money and QC invariants, shared by the verification scripts.
// Each returns results for the caller to feed into its own check(), so the
// tally stays the calling script's.

export interface InvariantResult {
  name: string;
  ok: boolean;
  detail?: unknown;
}

/** Every Invoice/Payment/Expense has exactly one original ledger entry for
 * its amount (and order), plus exactly one reversing entry iff it was
 * reversed; every reversal points at exactly one record; every invoiced
 * order's paymentStatus matches the ledger against its active invoices. */
export async function ledgerInvariants(db: PrismaClient): Promise<InvariantResult[]> {
  const [invoices, payments, expenses, entries, reversals] = await Promise.all([
    db.invoice.findMany({ select: { id: true, subtotal: true, orderId: true, reversal: { select: { id: true } } } }),
    db.payment.findMany({ select: { id: true, amount: true, invoice: { select: { orderId: true } }, reversal: { select: { id: true } } } }),
    db.expense.findMany({ select: { id: true, amount: true, orderId: true, reversal: { select: { id: true } } } }),
    db.ledgerEntry.findMany(),
    db.reversal.findMany(),
  ]);
  const bySource = new Map<string, typeof entries>();
  for (const e of entries) bySource.set(`${e.sourceType}:${e.sourceId}`, [...(bySource.get(`${e.sourceType}:${e.sourceId}`) ?? []), e]);

  const bad: string[] = [];
  const verify = (kind: string, id: string, amount: number, orderId: string | null, reversed: boolean) => {
    const rows = bySource.get(`${kind}:${id}`) ?? [];
    const originals = rows.filter((e) => e.reversesId === null);
    const undo = rows.filter((e) => e.reversesId !== null);
    if (originals.length !== 1 || Math.abs(originals[0].amount - amount) > 0.005 || originals[0].orderId !== orderId) {
      bad.push(`${kind} ${id}: original entry`);
    } else if (reversed ? undo.length !== 1 || undo[0].reversesId !== originals[0].id || Math.abs(undo[0].amount + amount) > 0.005 : undo.length !== 0) {
      bad.push(`${kind} ${id}: reversing entry`);
    }
  };
  for (const i of invoices) verify("Invoice", i.id, i.subtotal, i.orderId, !!i.reversal);
  for (const p of payments) verify("Payment", p.id, p.amount, p.invoice.orderId, !!p.reversal);
  for (const x of expenses) verify("Expense", x.id, x.amount, x.orderId, !!x.reversal);
  const orphans = entries.filter((e) => !["Invoice", "Payment", "Expense"].includes(e.sourceType));
  const malformed = reversals.filter((r) => [r.paymentId, r.expenseId, r.invoiceId, r.qcRecordId].filter(Boolean).length !== 1);

  const orders = await db.order.findMany({ where: { invoices: { some: {} } }, include: { invoices: { where: { reversal: { is: null } } } } });
  const wrong: string[] = [];
  for (const o of orders) {
    const total = o.invoices.reduce((s, i) => s + i.total, 0);
    const paid = entries.filter((e) => e.orderId === o.id && e.type === "payment_received").reduce((s, e) => s + e.amount, 0);
    const expected = total === 0 || paid <= 0.005 ? "UNPAID" : paid + 0.005 >= total ? "PAID" : "PARTIAL";
    if (o.paymentStatus !== expected) wrong.push(`${o.orderNo}: ${o.paymentStatus} vs ${expected}`);
  }

  return [
    {
      name: `every invoice/payment/expense has one original ledger entry, and one reversing entry iff reversed (${invoices.length + payments.length + expenses.length} rows)`,
      ok: bad.length === 0,
      detail: bad.slice(0, 10),
    },
    { name: "no ledger entry with an unknown source type", ok: orphans.length === 0, detail: orphans.slice(0, 3) },
    { name: "every reversal points at exactly one record", ok: malformed.length === 0, detail: malformed.slice(0, 3) },
    { name: `paymentStatus matches the ledger and active invoices on all ${orders.length} invoiced orders`, ok: wrong.length === 0, detail: wrong },
  ];
}
