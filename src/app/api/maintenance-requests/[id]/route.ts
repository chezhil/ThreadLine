import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { approvalActionSchema } from "@/lib/validation/approvals";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";

// PATCH { status, cost? } — owner only. Approving records the go-ahead (and
// an optional repair cost estimate); it doesn't itself change the machine's
// status — the floor supervisor still flips it back to RUNNING via the
// existing machines/:id/status route once it's actually fixed.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = approvalActionSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const existing = await db.maintenanceRequest.findUnique({ where: { id } });
  if (!existing) return notFound("Maintenance request not found");
  if (existing.status !== "PENDING") {
    return fieldErrorResponse({ status: [`Already ${existing.status.toLowerCase()}`] });
  }

  const updated = await db.maintenanceRequest.update({
    where: { id },
    data: {
      status: parsed.data.status,
      approvedBy: user.id,
      approvedAt: new Date(),
      cost: parsed.data.cost ?? existing.cost,
    },
  });
  await logAudit("MaintenanceRequest", id, "status_change", { status: "PENDING" }, { status: updated.status }, user.id);
  return NextResponse.json({ request: updated });
}
