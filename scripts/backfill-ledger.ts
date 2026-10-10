// One-time (but safely re-runnable) backfill for HARDENING_ADDENDUM.md item
// 3: every Invoice/Payment/Expense row that predates the ledger wiring gets
// its LedgerEntry. seed.ts calls the same underlying function at the end of
// its own recompute pass, so a fresh `npm run seed` never needs this —
// this script is for backfilling an existing database (e.g. this repo's
// dev.db, the first time the ledger was added).
import { db } from "../src/lib/db";
import { backfillLedgerEntries } from "../src/lib/ledger";

async function main() {
  const result = await backfillLedgerEntries(db);
  console.log(`Backfilled: ${result.invoices} invoice(s), ${result.payments} payment(s), ${result.expenses} expense(s), ${result.reversals} reversal(s) ledger entries.`);
  await db.$disconnect();
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
