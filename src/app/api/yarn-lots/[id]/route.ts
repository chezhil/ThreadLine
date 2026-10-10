import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { checkLowStockAndNotify } from "@/lib/inventory";
import { yarnLotUpdateSchema, type YarnLotInput } from "@/lib/validation/yarn";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { describeCounts, inUse } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string }> };

const KG_TOLERANCE = 0.000001;

class LotFieldError extends Error {
  constructor(
    public field: keyof YarnLotInput,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// PATCH — correct an intake (owner and storekeeper). Remaining stock moves
// with the received quantity (what is already reserved stays reserved), and a
// lot that is reserved or made into rolls keeps its yarn type: those rows were
// costed and traced as that yarn.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();
  const { id } = await params;

  const parsed = yarnLotUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const input = parsed.data;

  let result;
  try {
    result = await writeTransaction(async (tx) => {
      const before = await tx.yarnLot.findUnique({
        where: { id },
        include: { reservations: { select: { orderId: true } }, _count: { select: { rolls: true } } },
      });
      if (!before) return null;
      const used = before.reservations.length > 0 || before._count.rolls > 0;

      if (input.yarnTypeId && input.yarnTypeId !== before.yarnTypeId) {
        if (used) throw new LotFieldError("yarnTypeId", "This lot is already reserved or made into rolls, so its yarn type can't change");
        const yarnType = await tx.yarnType.findUnique({ where: { id: input.yarnTypeId } });
        if (!yarnType) throw new LotFieldError("yarnTypeId", "Yarn type not found");
        if (yarnType.archivedAt) throw new LotFieldError("yarnTypeId", "This yarn type is archived; restore it first");
      }
      if (input.supplierId && input.supplierId !== before.supplierId) {
        const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
        if (!supplier) throw new LotFieldError("supplierId", "Supplier not found");
        if (supplier.archivedAt) throw new LotFieldError("supplierId", "This supplier is archived; restore it first");
      }
      const lotNo = input.lotNo ?? before.lotNo;
      const supplierId = input.supplierId ?? before.supplierId;
      if (await tx.yarnLot.findFirst({ where: { lotNo, supplierId, NOT: { id } }, select: { id: true } })) {
        throw new LotFieldError("lotNo", `Lot ${lotNo} from this supplier is already recorded`, 409);
      }
      if (input.linkedOrderId) {
        const order = await tx.order.findUnique({ where: { id: input.linkedOrderId }, select: { status: true } });
        if (!order) throw new LotFieldError("linkedOrderId", "Order not found");
        if (order.status === "CLOSED") throw new LotFieldError("linkedOrderId", "That order is closed");
        if (before.reservations.some((r) => r.orderId !== input.linkedOrderId)) {
          throw new LotFieldError("linkedOrderId", "Other orders already reserved yarn from this lot");
        }
      }

      const reservedKg = before.qtyReceivedKg - before.qtyRemainingKg;
      const qtyReceivedKg = input.qtyReceivedKg ?? before.qtyReceivedKg;
      const qtyRemainingKg = qtyReceivedKg - reservedKg;
      if (qtyRemainingKg < -KG_TOLERANCE) {
        throw new LotFieldError("qtyReceivedKg", `${reservedKg.toFixed(1)} kg of this lot is already reserved, so it can't be less than that`);
      }

      const after = await tx.yarnLot.update({
        where: { id },
        data: { ...input, qtyRemainingKg: Math.max(0, qtyRemainingKg) },
      });
      const { reservations, _count, ...snapshot } = before;
      void reservations;
      void _count;
      return { before: snapshot, after };
    });
  } catch (e) {
    if (e instanceof LotFieldError) return fieldErrorResponse({ [e.field]: [e.message] }, e.status);
    throw e;
  }
  if (!result) return notFound("Yarn lot not found");

  await logAudit("YarnLot", id, "update", result.before, result.after, user.id);
  for (const yarnTypeId of new Set([result.before.yarnTypeId, result.after.yarnTypeId])) {
    await checkLowStockAndNotify(yarnTypeId);
  }
  emitDataChanged({ entity: "YarnLot", id, action: "update" });
  return NextResponse.json({ yarnLot: result.after });
}

// Only a lot nothing has used yet — no reservation, no roll — can be removed
// (an intake recorded twice, or against the wrong delivery).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();
  const { id } = await params;

  const result = await writeTransaction(async (tx) => {
    const lot = await tx.yarnLot.findUnique({
      where: { id },
      include: { _count: { select: { reservations: true, rolls: true } } },
    });
    if (!lot) return { status: "missing" as const };
    const dependents = describeCounts([
      [lot._count.reservations, "reservation"],
      [lot._count.rolls, "roll"],
    ]);
    if (dependents) return { status: "in_use" as const, lotNo: lot.lotNo, dependents };
    await tx.yarnLot.delete({ where: { id } });
    const { _count, ...snapshot } = lot;
    void _count;
    return { status: "deleted" as const, snapshot };
  });
  if (result.status === "missing") return notFound("Yarn lot not found");
  if (result.status === "in_use") {
    return inUse(`Lot ${result.lotNo} has ${result.dependents}, so it can't be deleted. Correct its details instead.`);
  }

  await logAudit("YarnLot", id, "delete", result.snapshot, null, user.id);
  await checkLowStockAndNotify(result.snapshot.yarnTypeId);
  emitDataChanged({ entity: "YarnLot", id, action: "delete" });
  return NextResponse.json({ ok: true });
}
