import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { notify } from "@/lib/accounts/alerts";
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

  // One open request per yarn type: a second click (or a second storekeeper)
  // would otherwise queue the same purchase twice. Checked and created under
  // the write lock so two at once can't both pass the check.
  const request = await writeTransaction(async (tx) => {
    const open = await tx.purchaseRequest.findFirst({ where: { yarnTypeId: yarnType.id, status: "PENDING" } });
    if (open) return null;
    return tx.purchaseRequest.create({ data: { ...parsed.data, requestedBy: user.id } });
  });
  if (!request) {
    return fieldErrorResponse({ yarnTypeId: [`A purchase request for ${yarnType.name} (${yarnType.colour}) is already waiting for approval`] }, 409);
  }

  await logAudit("PurchaseRequest", request.id, "create", null, request, user.id);
  await notify(
    "approval_requested",
    `Purchase request: ${request.qtyKg} kg of ${yarnType.name} (${yarnType.colour}) raised by ${user.name}. Review it in Approvals.`,
    "info",
  );
  return NextResponse.json({ request }, { status: 201 });
}
