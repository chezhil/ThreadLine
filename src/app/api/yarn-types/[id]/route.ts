import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { checkLowStockAndNotify, resolveLowStockAlert } from "@/lib/inventory";
import { yarnTypeUpdateSchema } from "@/lib/validation/yarn";
import { archivedAtFor } from "@/lib/validation/common";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { describeCounts, inUse } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { name?, count?, material?, colour?, lowStockThresholdKg?, costPerKg?,
// archived? } — owner and storekeeper. costPerKg is what costing charges for
// every roll made from this yarn, past rolls included, so correcting a typo
// corrects past order costs too (the edit form says so).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = yarnTypeUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { archived, ...fields } = parsed.data;

  const result = await writeTransaction(async (tx) => {
    const before = await tx.yarnType.findUnique({ where: { id } });
    if (!before) return { status: "missing" as const };
    const name = fields.name ?? before.name;
    const count = fields.count ?? before.count;
    const colour = fields.colour ?? before.colour;
    if (await tx.yarnType.findFirst({ where: { name, count, colour, NOT: { id } } })) {
      return { status: "clash" as const, label: `${name} ${count} in ${colour}` };
    }
    const after = await tx.yarnType.update({
      where: { id },
      data: { ...fields, archivedAt: archivedAtFor(archived, before.archivedAt) },
    });
    return { status: "ok" as const, before, after };
  });
  if (result.status === "missing") return notFound("Yarn type not found");
  if (result.status === "clash") return fieldErrorResponse({ name: [`${result.label} already exists`] }, 409);

  const action = archived === undefined ? "update" : archived ? "archive" : "restore";
  await logAudit("YarnType", id, action, result.before, result.after, user.id);
  // The threshold, the name in the alert text or archiving can each change
  // whether (and how) this yarn shows as low.
  await checkLowStockAndNotify(id);
  emitDataChanged({ entity: "YarnType", id, action });
  return NextResponse.json({ yarnType: result.after });
}

// A yarn type with lots or purchase requests is history: archive it instead.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();
  const { id } = await params;

  const result = await writeTransaction(async (tx) => {
    const yarnType = await tx.yarnType.findUnique({
      where: { id },
      include: { _count: { select: { lots: true, purchaseRequests: true } } },
    });
    if (!yarnType) return { status: "missing" as const };
    const dependents = describeCounts([
      [yarnType._count.lots, "yarn lot"],
      [yarnType._count.purchaseRequests, "purchase request"],
    ]);
    if (dependents) return { status: "in_use" as const, name: yarnType.name, dependents };
    await tx.yarnType.delete({ where: { id } });
    await resolveLowStockAlert(tx, id);
    const { _count, ...snapshot } = yarnType;
    void _count;
    return { status: "deleted" as const, snapshot };
  });
  if (result.status === "missing") return notFound("Yarn type not found");
  if (result.status === "in_use") {
    return inUse(`${result.name} has ${result.dependents}, so it can't be deleted. Archive it instead to hide it from intake and new orders.`);
  }

  await logAudit("YarnType", id, "delete", result.snapshot, null, user.id);
  emitDataChanged({ entity: "YarnType", id, action: "delete" });
  return NextResponse.json({ ok: true });
}
