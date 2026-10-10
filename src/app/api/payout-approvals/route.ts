import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { payoutApprovalSchema } from "@/lib/validation/approvals";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { monthSummary } from "@/lib/accounts/summary";

// Accounts domain — owner only end to end, same as the rest of /api/payments,
// /api/expenses etc. "requestedBy: system, at month-end" from the addendum's
// sketch becomes the owner flagging a month for payout from its own accrued
// wage total, since there's only one role that touches Accounts at all.
export async function GET() {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const requests = await db.payoutApproval.findMany({ orderBy: { month: "desc" } });
  return NextResponse.json({ requests, canApprove: true });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = payoutApprovalSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { month } = parsed.data;

  const existing = await db.payoutApproval.findUnique({ where: { month } });
  if (existing) return fieldErrorResponse({ month: [`A payout approval already exists for ${month} (${existing.status})`] }, 409);

  const summary = await monthSummary(month);
  const request = await db.payoutApproval.create({
    data: { month, totalWages: summary.wages.accrued, requestedBy: user.id },
  });
  await logAudit("PayoutApproval", request.id, "create", null, request, user.id);
  return NextResponse.json({ request }, { status: 201 });
}
