import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { expenseReversalSchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { istMidnight, monthLabel } from "@/lib/accounts/period";
import { expenseCategoryToLedgerType, postLedgerEntry } from "@/lib/ledger";
import { AlreadyReversed, reverseRecord } from "@/lib/reversals";
import { emitDataChanged } from "@/lib/realtime";

type Ctx = { params: Promise<{ id: string }> };

class ExpenseRefused extends Error {
  constructor(
    public field: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// POST { reason, correction?: { category, amount, date, orderId?, note? } } —
// owner only. The bill and its ledger entry stay; a Reversal marks it void and
// a reversing entry nets it out of the ledger. A correction is recorded as a
// new bill (with its own ledger entry) in the same transaction. The bill an
// approved wage payout created can't be reversed: the approval stands on it.
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = expenseReversalSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { reason, correction } = parsed.data;

  let result;
  try {
    result = await writeTransaction(async (tx) => {
      const expense = await tx.expense.findUnique({ where: { id } });
      if (!expense) return null;
      const payout = await tx.payoutApproval.findFirst({ where: { expenseId: id }, select: { month: true } });
      if (payout) {
        throw new ExpenseRefused("_form", `This is the approved wage payout for ${monthLabel(payout.month)}; it can't be reversed here`, 409);
      }

      let replacement = null;
      if (correction) {
        if (correction.orderId && !(await tx.order.findUnique({ where: { id: correction.orderId }, select: { id: true } }))) {
          throw new ExpenseRefused("correction.orderId", "Order not found");
        }
        const date = istMidnight(correction.date);
        replacement = await tx.expense.create({ data: { ...correction, date } });
        await postLedgerEntry(tx, {
          date,
          type: expenseCategoryToLedgerType(replacement.category),
          amount: replacement.amount,
          sourceType: "Expense",
          sourceId: replacement.id,
          orderId: replacement.orderId,
        });
      }
      const reversal = await reverseRecord(tx, { source: "Expense", id, reason, userId: user.id, replacementId: replacement?.id });
      return { original: expense, reversal, replacement };
    });
  } catch (e) {
    if (e instanceof AlreadyReversed) return fieldErrorResponse({ _form: ["This expense was already reversed"] }, 409);
    if (e instanceof ExpenseRefused) return fieldErrorResponse({ [e.field]: [e.message] }, e.status);
    throw e;
  }
  if (!result) return notFound("Expense not found");

  await logAudit("Expense", id, "reverse", result.original, { reason, replacementId: result.replacement?.id ?? null }, user.id);
  if (result.replacement) {
    await logAudit("Expense", result.replacement.id, "create", null, { ...result.replacement, corrects: id }, user.id);
  }
  emitDataChanged({ entity: "Expense", id, action: "reverse" });
  return NextResponse.json({ reversal: result.reversal, replacement: result.replacement }, { status: 201 });
}
