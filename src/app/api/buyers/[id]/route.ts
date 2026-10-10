import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { buyerUpdateSchema } from "@/lib/validation/order";
import { archivedAtFor } from "@/lib/validation/common";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { describeCounts, inUse } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name?, contact?, gstin?, address?, archived? } — owner only. A
// rename shows on the buyer's past orders, invoices and tracking page too
// (they reference the buyer, they don't copy the name).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = buyerUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { archived, ...fields } = parsed.data;

  const result = await writeTransaction(async (tx) => {
    const before = await tx.buyer.findUnique({ where: { id } });
    if (!before) return { status: "missing" as const };
    if (fields.name && fields.name !== before.name && (await tx.buyer.findFirst({ where: { name: fields.name, NOT: { id } } }))) {
      return { status: "clash" as const };
    }
    const after = await tx.buyer.update({
      where: { id },
      data: { ...fields, archivedAt: archivedAtFor(archived, before.archivedAt) },
    });
    return { status: "ok" as const, before, after };
  });
  if (result.status === "missing") return notFound("Buyer not found");
  if (result.status === "clash") return fieldErrorResponse({ name: ["A buyer with this name already exists"] }, 409);

  const action = archived === undefined ? "update" : archived ? "archive" : "restore";
  await logAudit("Buyer", id, action, result.before, result.after, user.id);
  emitDataChanged({ entity: "Buyer", id, action });
  return NextResponse.json({ buyer: result.after });
}

// A buyer with orders or dispatches is history: archive it instead.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();
  const { id } = await params;

  const result = await writeTransaction(async (tx) => {
    const buyer = await tx.buyer.findUnique({
      where: { id },
      include: { _count: { select: { orders: true, dispatches: true } } },
    });
    if (!buyer) return { status: "missing" as const };
    const dependents = describeCounts([
      [buyer._count.orders, "order"],
      [buyer._count.dispatches, "dispatch", "dispatches"],
    ]);
    if (dependents) return { status: "in_use" as const, name: buyer.name, dependents };
    await tx.buyer.delete({ where: { id } });
    const { _count, ...snapshot } = buyer;
    void _count;
    return { status: "deleted" as const, snapshot };
  });
  if (result.status === "missing") return notFound("Buyer not found");
  if (result.status === "in_use") {
    return inUse(`${result.name} has ${result.dependents}, so it can't be deleted. Archive the buyer instead to hide it from new orders.`);
  }

  await logAudit("Buyer", id, "delete", result.snapshot, null, user.id);
  emitDataChanged({ entity: "Buyer", id, action: "delete" });
  return NextResponse.json({ ok: true });
}
