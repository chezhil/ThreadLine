import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/accounts/alerts";
import { approvalActionSchema } from "@/lib/validation/approvals";
import { alreadyDecided, approvalVerb } from "@/lib/approvals/http";
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
  const { status, cost } = parsed.data;

  const existing = await db.maintenanceRequest.findUnique({ where: { id }, include: { machine: true } });
  if (!existing) return notFound("Maintenance request not found");
  if (existing.status !== "PENDING") return alreadyDecided(existing.status);

  const updated = await writeTransaction(async (tx) => {
    const claimed = await tx.maintenanceRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status,
        approvedBy: user.id,
        approvedAt: new Date(),
        // A cost estimate only means something on a repair that goes ahead.
        ...(status === "APPROVED" && cost !== undefined ? { cost } : {}),
      },
    });
    return claimed.count === 1 ? tx.maintenanceRequest.findUniqueOrThrow({ where: { id } }) : null;
  });
  if (!updated) {
    const now = await db.maintenanceRequest.findUniqueOrThrow({ where: { id } });
    return alreadyDecided(now.status);
  }

  await logAudit(
    "MaintenanceRequest",
    id,
    "status_change",
    { status: "PENDING" },
    { status: updated.status, cost: updated.cost },
    user.id,
  );
  await notify("approval_decided:maintenance", `Maintenance request for ${existing.machine.name} was ${approvalVerb(status)}.`, "info");
  return NextResponse.json({ request: updated });
}
