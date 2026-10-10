import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";

// HARDENING_ADDENDUM.md item 3: one immutable ledger every money-moving
// write posts to, in the same transaction as the row it describes. Never
// edit or delete a LedgerEntry — correcting a mistake is a new entry with
// reversesId set (see reverseLedgerEntry below).

type Db = PrismaClient | Prisma.TransactionClient;

export type LedgerEntryType =
  | "revenue"
  | "yarn_cost"
  | "wage_cost"
  | "power_cost"
  | "overhead"
  | "payment_received"
  | "reversal";

export interface PostLedgerEntryInput {
  date: Date;
  type: LedgerEntryType;
  amount: number;
  sourceType: "Invoice" | "Payment" | "Expense";
  sourceId: string;
  orderId?: string | null;
  note?: string | null;
}

/** Maps an Expense.category onto the ledger's economic-type vocabulary,
 * mirroring the exact bucketing costing.ts already uses (power stands
 * alone; overhead and other share one bucket). */
export function expenseCategoryToLedgerType(category: string): LedgerEntryType {
  if (category === "yarn") return "yarn_cost";
  if (category === "wages") return "wage_cost";
  if (category === "power") return "power_cost";
  return "overhead"; // "overhead" | "other"
}

export async function postLedgerEntry(tx: Db, input: PostLedgerEntryInput) {
  return tx.ledgerEntry.create({
    data: {
      date: input.date,
      type: input.type,
      amount: input.amount,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      orderId: input.orderId ?? null,
      note: input.note ?? null,
    },
  });
}

/** Reverses an existing entry: a new row, same type/source/order, negated
 * amount, reversesId pointing at the original. The original is never
 * touched — nothing here calls update or delete on a LedgerEntry. */
export async function reverseLedgerEntry(tx: Db, originalId: string, note?: string) {
  const original = await tx.ledgerEntry.findUniqueOrThrow({ where: { id: originalId } });
  return tx.ledgerEntry.create({
    data: {
      date: new Date(),
      type: original.type,
      amount: -original.amount,
      sourceType: original.sourceType,
      sourceId: original.sourceId,
      orderId: original.orderId,
      reversesId: original.id,
      note: note ?? `Reversal of ${original.id}`,
    },
  });
}

/** Net amount by type for a given source row — "where did this number come
 * from" for one Invoice/Payment/Expense, including any reversal. */
export async function ledgerForSource(sourceType: string, sourceId: string, client: Db = db) {
  return client.ledgerEntry.findMany({
    where: { sourceType, sourceId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Backfills a LedgerEntry for every Invoice/Payment/Expense row that
 * predates (or bypassed, e.g. a seed script writing Prisma rows directly)
 * the ledger wiring in the live write paths. Idempotent — skips any
 * sourceId that already has an entry — so it's safe to call from both the
 * standalone script and the end of `seed.ts`'s own recompute pass.
 */
export async function backfillLedgerEntries(client: PrismaClient = db) {
  const existing = await client.ledgerEntry.findMany({ select: { sourceType: true, sourceId: true } });
  const have = new Set(existing.map((e) => `${e.sourceType}:${e.sourceId}`));

  let invoices = 0, payments = 0, expenses = 0;

  for (const inv of await client.invoice.findMany()) {
    if (have.has(`Invoice:${inv.id}`)) continue;
    await postLedgerEntry(client, {
      date: inv.createdAt,
      type: "revenue",
      amount: inv.subtotal,
      sourceType: "Invoice",
      sourceId: inv.id,
      orderId: inv.orderId,
    });
    invoices++;
  }

  for (const p of await client.payment.findMany({ include: { invoice: { select: { orderId: true } } } })) {
    if (have.has(`Payment:${p.id}`)) continue;
    await postLedgerEntry(client, {
      date: p.receivedAt,
      type: "payment_received",
      amount: p.amount,
      sourceType: "Payment",
      sourceId: p.id,
      orderId: p.invoice.orderId,
    });
    payments++;
  }

  for (const e of await client.expense.findMany()) {
    if (have.has(`Expense:${e.id}`)) continue;
    await postLedgerEntry(client, {
      date: e.date,
      type: expenseCategoryToLedgerType(e.category),
      amount: e.amount,
      sourceType: "Expense",
      sourceId: e.id,
      orderId: e.orderId,
    });
    expenses++;
  }

  return { invoices, payments, expenses };
}
