import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/accounts/alerts";
import { approvalActionSchema } from "@/lib/validation/approvals";
import { alreadyDecided, approvalVerb } from "@/lib/approvals/http";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";

// PATCH { status: "APPROVED" | "REJECTED" } — owner only. Approving is the
// green light to go place the order with a supplier; it does not create
// stock itself — that still happens through the existing yarn-lots POST
// route once the yarn physically arrives.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = approvalActionSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { status } = parsed.data;

  const existing = await db.purchaseRequest.findUnique({ where: { id }, include: { yarnType: true } });
  if (!existing) return notFound("Purchase request not found");
  if (existing.status !== "PENDING") return alreadyDecided(existing.status);

  const updated = await writeTransaction(async (tx) => {
    const claimed = await tx.purchaseRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status, approvedBy: user.id, approvedAt: new Date() },
    });
    return claimed.count === 1 ? tx.purchaseRequest.findUniqueOrThrow({ where: { id } }) : null;
  });
  if (!updated) {
    const now = await db.purchaseRequest.findUniqueOrThrow({ where: { id } });
    return alreadyDecided(now.status);
  }

  await logAudit("PurchaseRequest", id, "status_change", { status: "PENDING" }, { status: updated.status }, user.id);
  await notify(
    "approval_decided",
    `Purchase request for ${updated.qtyKg} kg of ${existing.yarnType.name} (${existing.yarnType.colour}) was ${approvalVerb(status)}.`,
    "info",
  );
  return NextResponse.json({ request: updated });
}
