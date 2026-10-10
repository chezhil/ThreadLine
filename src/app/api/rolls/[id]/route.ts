import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qualityActor } from "@/lib/quality/auth";
import { presentRolls, rollInclude } from "@/lib/quality/roll-view";
import { lotServesOrder } from "@/lib/quality/lineage";
import { updateRollSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { writeTransaction } from "@/lib/concurrency";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { recomputeRollAggregates, recordStatusChanges } from "@/lib/order-status";
import { queueOrderReadyAlert } from "@/lib/alerts/order-alerts";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const actor = await qualityActor();
  if ("response" in actor) return actor.response;
  try {
    const { id } = await params;

    const roll = await db.roll.findUnique({
      where: { id },
      include: rollInclude(actor.user.role, { supplier: true }),
    });

    if (!roll) {
      return NextResponse.json({ error: "Roll not found" }, { status: 404 });
    }

    return NextResponse.json((await presentRolls([roll]))[0]);
  } catch (err) {
    console.error("Failed to fetch roll:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

class RollRefused extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
  ) {
    super(message);
  }
}

function refusal(err: RollRefused) {
  return NextResponse.json(err.field ? { fieldErrors: { [err.field]: err.message }, error: err.message } : { error: err.message }, { status: err.status });
}

// PATCH { lengthMetres?, weightKg?, shift?, yarnLotId? } — correct a roll that
// hasn't left the mill (the roles that mint rolls). A shipped roll is on an
// invoice and a truck, so it stays as it went out.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const actor = await qualityActor("owner", "floor_supervisor", "qc_inspector");
  if ("response" in actor) return actor.response;
  const { id } = await params;
  const parsed = updateRollSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return handleZodError(parsed.error);
  const input = parsed.data;

  let result;
  try {
    result = await writeTransaction(async (tx) => {
      const before = await tx.roll.findUnique({ where: { id } });
      if (!before) throw new RollRefused("Roll not found", 404);
      if (before.dispatchId) throw new RollRefused("This roll has been dispatched, so it can't be changed", 409);
      if (input.yarnLotId && input.yarnLotId !== before.yarnLotId) {
        const lot = await lotServesOrder(tx, input.yarnLotId, before.orderId);
        if (lot === "missing") throw new RollRefused("Yarn lot not found", 400, "yarnLotId");
        if (lot === "foreign") throw new RollRefused("This yarn lot isn't reserved for this order", 400, "yarnLotId");
      }
      // Conditional on still being undispatched: a truck loading it at the
      // same moment wins, and this edit is refused.
      const changed = await tx.roll.updateMany({ where: { id, dispatchId: null }, data: input });
      if (changed.count !== 1) throw new RollRefused("This roll was just dispatched, so it can't be changed", 409);
      return { before, after: await tx.roll.findUniqueOrThrow({ where: { id } }) };
    });
  } catch (err) {
    if (err instanceof RollRefused) return refusal(err);
    throw err;
  }

  await logAudit("Roll", id, "UPDATE", result.before, result.after, actor.user.id);
  emitDataChanged({ entity: "Roll", id, action: "update" });
  const roll = await db.roll.findUniqueOrThrow({ where: { id }, include: rollInclude(actor.user.role, { supplier: true }) });
  return NextResponse.json((await presentRolls([roll]))[0]);
}

// DELETE — a roll minted by mistake (a duplicate, or against the wrong order):
// only while it has never been inspected or dispatched. Removing a pending
// roll can let its order become READY.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const actor = await qualityActor("owner", "floor_supervisor", "qc_inspector");
  if ("response" in actor) return actor.response;
  const { id } = await params;

  let result;
  try {
    result = await writeTransaction(async (tx) => {
      const roll = await tx.roll.findUnique({ where: { id }, include: { _count: { select: { qcRecords: true } } } });
      if (!roll) throw new RollRefused("Roll not found", 404);
      if (roll.dispatchId) throw new RollRefused("This roll has been dispatched, so it can't be deleted", 409);
      if (roll._count.qcRecords > 0) {
        throw new RollRefused("This roll has been inspected; its QC history must stay. Reverse a wrong inspection instead.", 409);
      }
      await tx.roll.delete({ where: { id } });
      const statusChange = await recomputeRollAggregates(tx, roll.orderId);
      await queueOrderReadyAlert(tx, statusChange);
      const { _count, ...snapshot } = roll;
      void _count;
      return { snapshot, statusChange };
    });
  } catch (err) {
    if (err instanceof RollRefused) return refusal(err);
    throw err;
  }

  await logAudit("Roll", id, "DELETE", result.snapshot, null, actor.user.id);
  await recordStatusChanges([result.statusChange], actor.user.id);
  emitDataChanged({ entity: "Roll", id, action: "delete" });
  return NextResponse.json({ deleted: true });
}
