import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/accounts/alerts";
import { maintenanceRequestSchema } from "@/lib/validation/approvals";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";

// GET — owner and floor_supervisor (raises these on a machine BREAKDOWN).
export async function GET() {
  const user = await requireRole("owner", "floor_supervisor");
  if (!user) return forbidden();

  const requests = await db.maintenanceRequest.findMany({
    include: { machine: { select: { name: true, type: true, status: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests, canApprove: user.role === "owner" });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "floor_supervisor");
  if (!user) return forbidden();

  const parsed = maintenanceRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const machine = await db.machine.findUnique({ where: { id: parsed.data.machineId } });
  if (!machine) return fieldErrorResponse({ machineId: ["Machine not found"] });

  // One open request per machine, checked under the write lock.
  const request = await writeTransaction(async (tx) => {
    const open = await tx.maintenanceRequest.findFirst({ where: { machineId: machine.id, status: "PENDING" } });
    if (open) return null;
    return tx.maintenanceRequest.create({ data: { ...parsed.data, requestedBy: user.id } });
  });
  if (!request) {
    return fieldErrorResponse({ machineId: [`${machine.name} already has a maintenance request waiting for approval`] }, 409);
  }

  await logAudit("MaintenanceRequest", request.id, "create", null, request, user.id);
  await notify(
    "approval_requested",
    `Maintenance request for ${machine.name}: "${request.description}" raised by ${user.name}. Review it in Approvals.`,
    "warning",
  );
  return NextResponse.json({ request }, { status: 201 });
}
