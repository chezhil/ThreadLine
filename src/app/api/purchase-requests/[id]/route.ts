import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { approvalActionSchema } from "@/lib/validation/approvals";
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

  const existing = await db.purchaseRequest.findUnique({ where: { id } });
  if (!existing) return notFound("Purchase request not found");
  if (existing.status !== "PENDING") {
    return fieldErrorResponse({ status: [`Already ${existing.status.toLowerCase()}`] });
  }

  const updated = await db.purchaseRequest.update({
    where: { id },
    data: { status: parsed.data.status, approvedBy: user.id, approvedAt: new Date() },
  });
  await logAudit("PurchaseRequest", id, "status_change", { status: "PENDING" }, { status: updated.status }, user.id);
  return NextResponse.json({ request: updated });
}
