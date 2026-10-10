import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { supplierUpdateSchema } from "@/lib/validation/yarn";
import { archivedAtFor } from "@/lib/validation/common";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { describeCounts, inUse } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name?, contact?, gstin?, archived? } — owner and storekeeper, the
// roles that record intake.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = supplierUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { archived, ...fields } = parsed.data;

  const result = await writeTransaction(async (tx) => {
    const before = await tx.supplier.findUnique({ where: { id } });
    if (!before) return { status: "missing" as const };
    if (fields.name && fields.name !== before.name && (await tx.supplier.findFirst({ where: { name: fields.name, NOT: { id } } }))) {
      return { status: "clash" as const };
    }
    const after = await tx.supplier.update({
      where: { id },
      data: { ...fields, archivedAt: archivedAtFor(archived, before.archivedAt) },
    });
    return { status: "ok" as const, before, after };
  });
  if (result.status === "missing") return notFound("Supplier not found");
  if (result.status === "clash") return fieldErrorResponse({ name: ["A supplier with this name already exists"] }, 409);

  const action = archived === undefined ? "update" : archived ? "archive" : "restore";
  await logAudit("Supplier", id, action, result.before, result.after, user.id);
  emitDataChanged({ entity: "Supplier", id, action });
  return NextResponse.json({ supplier: result.after });
}

// A supplier whose yarn lots are on record is history: archive it instead.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();
  const { id } = await params;

  const result = await writeTransaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id }, include: { _count: { select: { yarnLots: true } } } });
    if (!supplier) return { status: "missing" as const };
    const dependents = describeCounts([[supplier._count.yarnLots, "yarn lot"]]);
    if (dependents) return { status: "in_use" as const, name: supplier.name, dependents };
    await tx.supplier.delete({ where: { id } });
    const { _count, ...snapshot } = supplier;
    void _count;
    return { status: "deleted" as const, snapshot };
  });
  if (result.status === "missing") return notFound("Supplier not found");
  if (result.status === "in_use") {
    return inUse(`${result.name} supplied ${result.dependents}, so it can't be deleted. Archive the supplier instead to hide it from intake.`);
  }

  await logAudit("Supplier", id, "delete", result.snapshot, null, user.id);
  emitDataChanged({ entity: "Supplier", id, action: "delete" });
  return NextResponse.json({ ok: true });
}
