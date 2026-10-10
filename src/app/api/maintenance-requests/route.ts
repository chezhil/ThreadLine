import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
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

  const request = await db.maintenanceRequest.create({
    data: { ...parsed.data, requestedBy: user.id },
  });
  await logAudit("MaintenanceRequest", request.id, "create", null, request, user.id);
  return NextResponse.json({ request }, { status: 201 });
}
