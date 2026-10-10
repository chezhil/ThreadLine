import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { payoutApprovalSchema } from "@/lib/validation/approvals";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { accruedWages } from "@/lib/accounts/summary";
import { currentMonthKey, monthLabel } from "@/lib/accounts/period";

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

  if (month > currentMonthKey()) {
    return fieldErrorResponse({ month: [`${monthLabel(month)} hasn't started yet`] });
  }
  const totalWages = await accruedWages(month);
  if (totalWages <= 0) {
    return fieldErrorResponse({ month: [`No wages are accrued for ${monthLabel(month)} — mark attendance first`] });
  }

  // One approval per month (unique). A rejected month can be raised again:
  // the same row goes back to PENDING with the current wage total.
  let result: { request: Awaited<ReturnType<typeof db.payoutApproval.create>>; before: unknown } | { taken: string };
  try {
    result = await writeTransaction(async (tx) => {
      const existing = await tx.payoutApproval.findUnique({ where: { month } });
      if (existing && existing.status !== "REJECTED") return { taken: existing.status };
      if (existing) {
        const request = await tx.payoutApproval.update({
          where: { id: existing.id },
          data: { status: "PENDING", totalWages, requestedBy: user.id, approvedBy: null, approvedAt: null, createdAt: new Date() },
        });
        return { request, before: existing };
      }
      return { request: await tx.payoutApproval.create({ data: { month, totalWages, requestedBy: user.id } }), before: null };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") result = { taken: "PENDING" };
    else throw e;
  }
  if ("taken" in result) {
    return fieldErrorResponse(
      { month: [`A payout approval already exists for ${monthLabel(month)} (${result.taken.toLowerCase()})`] },
      409,
    );
  }

  await logAudit("PayoutApproval", result.request.id, result.before ? "reopen" : "create", result.before, result.request, user.id);
  return NextResponse.json({ request: result.request }, { status: 201 });
}
