import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { approvalActionSchema } from "@/lib/validation/approvals";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { postLedgerEntry } from "@/lib/ledger";
import { istMidnight } from "@/lib/accounts/period";

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

  const existing = await db.payoutApproval.findUnique({ where: { id } });
  if (!existing) return notFound("Payout approval not found");
  if (existing.status !== "PENDING") {
    return fieldErrorResponse({ status: [`Already ${existing.status.toLowerCase()}`] });
  }

  const updated = await db.$transaction(async (tx) => {
    let expenseId: string | null = null;
    if (parsed.data.status === "APPROVED") {
      const date = istMidnight(new Date());
      const expense = await tx.expense.create({
        data: {
          category: "wages",
          amount: existing.totalWages,
          date,
          note: `Payout approval for ${existing.month}`,
        },
      });
      await postLedgerEntry(tx, {
        date,
        type: "wage_cost",
        amount: expense.amount,
        sourceType: "Expense",
        sourceId: expense.id,
      });
      expenseId = expense.id;
    }
    return tx.payoutApproval.update({
      where: { id },
      data: { status: parsed.data.status, approvedBy: user.id, approvedAt: new Date(), expenseId },
    });
  });

  await logAudit("PayoutApproval", id, "status_change", { status: "PENDING" }, { status: updated.status, expenseId: updated.expenseId }, user.id);
  return NextResponse.json({ request: updated });
}
