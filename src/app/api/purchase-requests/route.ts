import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { purchaseRequestSchema } from "@/lib/validation/approvals";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";

// GET — owner and storekeeper (the role that raises these from Inventory's
// low-stock card) can both see the queue; canApprove tells the client
// whether to render Approve/Reject (owner only).
export async function GET() {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const requests = await db.purchaseRequest.findMany({
    include: { yarnType: { select: { name: true, colour: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ requests, canApprove: user.role === "owner" });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const parsed = purchaseRequestSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const yarnType = await db.yarnType.findUnique({ where: { id: parsed.data.yarnTypeId } });
  if (!yarnType) return fieldErrorResponse({ yarnTypeId: ["Yarn type not found"] });

  const request = await db.purchaseRequest.create({
    data: { ...parsed.data, requestedBy: user.id },
  });
  await logAudit("PurchaseRequest", request.id, "create", null, request, user.id);
  return NextResponse.json({ request }, { status: 201 });
}
