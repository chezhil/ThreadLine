import type { Prisma } from "@prisma/client";
import { reverseLedgerEntry } from "./ledger";

// Payments, Expenses, Invoices and QC inspections are append-only. A wrong
// one is reversed (see the Reversal model): the row stays, a Reversal marks it
// void and — for money — a reversing LedgerEntry nets it out. Every reader
// that sums or shows "the current" figure filters reversed rows with this.
export const notReversed = { reversal: { is: null } } satisfies Prisma.PaymentWhereInput &
  Prisma.ExpenseWhereInput &
  Prisma.InvoiceWhereInput &
  Prisma.QCRecordWhereInput;

/** What a reversal looks like to a reader that shows history. */
export const reversalSummary = {
  select: { reason: true, createdAt: true, replacementId: true, reversedBy: true },
} satisfies Prisma.ReversalDefaultArgs;

export class AlreadyReversed extends Error {
  constructor() {
    super("This record has already been reversed");
  }
}

type ReversibleSource = "Payment" | "Expense" | "Invoice" | "QCRecord";

type SourceLink = Pick<Prisma.ReversalUncheckedCreateInput, "paymentId" | "expenseId" | "invoiceId" | "qcRecordId">;

function sourceLink(source: ReversibleSource, id: string): SourceLink {
  switch (source) {
    case "Payment":
      return { paymentId: id };
    case "Expense":
      return { expenseId: id };
    case "Invoice":
      return { invoiceId: id };
    case "QCRecord":
      return { qcRecordId: id };
  }
}

export interface ReverseInput {
  source: ReversibleSource;
  id: string;
  reason: string;
  userId: string;
  /** The corrected row of the same kind, when this reversal is a correction. */
  replacementId?: string | null;
}

/**
 * Marks one record reversed inside the caller's write transaction and, for a
 * money record, posts the reversing ledger entry. Throws AlreadyReversed if it
 * was reversed first (the check runs under the write lock; the unique index
 * on each Reversal foreign key is the backstop).
 */
export async function reverseRecord(tx: Prisma.TransactionClient, input: ReverseInput) {
  const link = sourceLink(input.source, input.id);
  if (await tx.reversal.findFirst({ where: link, select: { id: true } })) throw new AlreadyReversed();

  const reversal = await tx.reversal.create({
    data: {
      ...link,
      reason: input.reason,
      reversedBy: input.userId,
      replacementId: input.replacementId ?? null,
    },
  });
  if (input.source !== "QCRecord") {
    // Every money row posts exactly one original entry when it is written
    // (and the seed backfill covers older rows), so a missing one is a broken
    // ledger, not something to paper over.
    const original = await tx.ledgerEntry.findFirstOrThrow({
      where: { sourceType: input.source, sourceId: input.id, reversesId: null },
    });
    await reverseLedgerEntry(tx, original.id, `Reversed: ${input.reason}`);
  }
  return reversal;
}
