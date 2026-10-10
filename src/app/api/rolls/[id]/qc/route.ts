import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { qcInspectionSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import { recomputeRollAggregates, recordStatusChanges } from "@/lib/order-status";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await qualityActor("owner", "qc_inspector");
  if ("response" in actor) return actor.response;
  try {
    const { id } = await params;
    const body = await req.json().catch(() => null);

    const parsed = qcInspectionSchema.safeParse(body);
    if (!parsed.success) {
      return handleZodError(parsed.error);
    }

    const data = parsed.data;

    // Idempotency check for offline replay. The id must belong to THIS roll:
    // a stale or forged id from another roll is a conflict, not a success.
    if (data.clientMutationId) {
      const existing = await db.qCRecord.findUnique({
        where: { id: data.clientMutationId },
        include: { roll: true },
      });
      if (existing) {
        if (existing.rollId !== id) {
          return NextResponse.json({ error: "This inspection id was already used for another roll" }, { status: 409 });
        }
        return NextResponse.json({
          success: true,
          qcRecord: existing,
          roll: existing.roll,
        });
      }
    }

    // Check if roll exists
    const roll = await db.roll.findUnique({
      where: { id },
      include: {
        qcRecords: {
          orderBy: { inspectedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!roll) {
      return NextResponse.json({ error: `Roll not found: ${id}` }, { status: 404 });
    }

    // A roll that has already been dispatched cannot be altered
    if (roll.dispatchId) {
      return NextResponse.json(
        { error: "This roll has already been dispatched and cannot be re-inspected." },
        { status: 400 }
      );
    }

    // An inspection queued offline keeps the time it was really made (within
    // reason), so replaying an old queue can't override a newer inspection.
    const now = Date.now();
    let inspectedAt = new Date(now);
    if (data.clientRecordedAt) {
      const t = new Date(data.clientRecordedAt).getTime();
      if (t <= now + 5 * 60_000 && t >= now - 14 * 24 * 3600_000) inspectedAt = new Date(Math.min(t, now));
    }

    // Create the QC record, update the roll, and recompute the order-level
    // aggregates, all atomically. The roll update is conditional on it still
    // being undispatched, so a dispatch that lands between the check above
    // and this write can't have its shipped roll re-graded.
    const { qcRecord, updatedRoll, statusChange, previousStatus, applied } = await writeTransaction(async (tx) => {
      const current = await tx.roll.findUniqueOrThrow({
        where: { id: roll.id },
        include: { qcRecords: { orderBy: { inspectedAt: "desc" }, take: 1 } },
      });
      const newer = current.qcRecords[0] && current.qcRecords[0].inspectedAt > inspectedAt;
      const qcRecord = await tx.qCRecord.create({
        data: {
          id: data.clientMutationId || undefined,
          rollId: roll.id,
          // The signed-in inspector, never a client-supplied id.
          inspectorId: actor.user.id,
          result: data.result,
          defects: JSON.stringify(data.defects),
          notes: data.notes || null,
          inspectedAt,
        },
      });
      // A late-arriving older inspection is kept in the history but doesn't
      // override the roll's current grade.
      if (!newer) {
        const claimed = await tx.roll.updateMany({
          where: { id: roll.id, dispatchId: null },
          data: { qcStatus: data.result },
        });
        if (claimed.count !== 1) throw new RollDispatched();
      }
      const updatedRoll = await tx.roll.findUniqueOrThrow({
        where: { id: roll.id },
        include: {
          order: { select: { id: true, orderNo: true, status: true } },
          machine: true,
          yarnLot: true,
        },
      });
      const statusChange = await recomputeRollAggregates(tx, updatedRoll.orderId);
      return { qcRecord, updatedRoll, statusChange, previousStatus: current.qcStatus, applied: !newer };
    });

    await logAudit(
      "Roll",
      roll.id,
      "QC_INSPECT",
      { qcStatus: previousStatus },
      { qcStatus: updatedRoll.qcStatus, result: data.result, defects: data.defects, notes: data.notes, applied },
      actor.user.id
    );
    await recordStatusChanges([statusChange], actor.user.id);

    emit(RealtimeEvents.QcCompleted, {
      rollId: roll.id,
      rollNo: roll.rollNo,
      result: data.result,
    });

    return NextResponse.json({
      success: true,
      qcRecord,
      roll: updatedRoll,
    });
  } catch (err) {
    if (err instanceof RollDispatched) {
      return NextResponse.json(
        { error: "This roll was just dispatched and cannot be re-inspected." },
        { status: 400 }
      );
    }
    console.error("Failed to submit QC inspection:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

class RollDispatched extends Error {}
