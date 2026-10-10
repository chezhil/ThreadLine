import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { approvalActionSchema } from "@/lib/validation/approvals";
import { alreadyDecided } from "@/lib/approvals/http";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { inr } from "@/lib/accounts/format";
import { postLedgerEntry } from "@/lib/ledger";
import { istMidnight, monthLabel } from "@/lib/accounts/period";
import { accruedWages } from "@/lib/accounts/summary";

// PATCH { status } — owner only. Unlike the other two approval types,
// APPROVING here *is* the real-world event (the owner releasing the
// month's wages), so it creates the payout Expense (category "wages" —
// the same bucket scripts/seed-accounts.ts and costing.ts already treat as
// a payroll payout, not spread onto orders) and its ledger entry in the
// same transaction. Rejecting creates nothing.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = approvalActionSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { status } = parsed.data;

  const existing = await db.payoutApproval.findUnique({ where: { id } });
  if (!existing) return notFound("Payout approval not found");
  if (existing.status !== "PENDING") return alreadyDecided(existing.status);

  // Attendance can still change after the request was raised (a late mark,
  // a corrected half-day). Never pay out a stale figure: refresh the request
  // and ask the owner to approve the current total.
  if (status === "APPROVED") {
    const current = await accruedWages(existing.month);
    if (Math.abs(current - existing.totalWages) > 0.005) {
      await db.payoutApproval.updateMany({ where: { id, status: "PENDING" }, data: { totalWages: current } });
      return fieldErrorResponse(
        {
          status: [
            `Wages for ${monthLabel(existing.month)} changed from ${inr(existing.totalWages, { decimals: true })} to ${inr(current, { decimals: true })} since this was raised. Check the new total and approve again.`,
          ],
        },
        409,
      );
    }
  }

  const updated = await writeTransaction(async (tx) => {
    const claimed = await tx.payoutApproval.updateMany({
      where: { id, status: "PENDING", totalWages: existing.totalWages },
      data: { status, approvedBy: user.id, approvedAt: new Date() },
    });
    if (claimed.count !== 1) return null;
    if (status === "APPROVED") {
      const date = istMidnight(new Date());
      const expense = await tx.expense.create({
        data: {
          category: "wages",
          amount: existing.totalWages,
          date,
          note: `Wage payout for ${monthLabel(existing.month)} (approved)`,
        },
      });
      await postLedgerEntry(tx, {
        date,
        type: "wage_cost",
        amount: expense.amount,
        sourceType: "Expense",
        sourceId: expense.id,
      });
      await tx.payoutApproval.update({ where: { id }, data: { expenseId: expense.id } });
    }
    return tx.payoutApproval.findUniqueOrThrow({ where: { id } });
  });
  if (!updated) {
    const now = await db.payoutApproval.findUniqueOrThrow({ where: { id } });
    if (now.status === "PENDING") {
      return fieldErrorResponse({ status: ["This payout's total just changed. Check it and approve again."] }, 409);
    }
    return alreadyDecided(now.status);
  }

  await logAudit("PayoutApproval", id, "status_change", { status: "PENDING" }, { status: updated.status, expenseId: updated.expenseId }, user.id);
  if (updated.expenseId) {
    const expense = await db.expense.findUnique({ where: { id: updated.expenseId } });
    await logAudit("Expense", updated.expenseId, "create", null, expense, user.id);
  }
  return NextResponse.json({ request: updated });
}
