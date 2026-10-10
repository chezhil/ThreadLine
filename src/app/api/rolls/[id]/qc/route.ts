import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qcInspectionSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import { recomputeQcStatus } from "@/lib/order-status";

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

    const previousStatus = roll.qcStatus;

    // Create the QC record, update the roll, and recompute the order-level
    // qcStatus aggregate, all atomically.
    const { qcRecord, updatedRoll } = await db.$transaction(async (tx) => {
      const qcRecord = await tx.qCRecord.create({
        data: {
          rollId: roll.id,
          // The signed-in inspector, never a client-supplied id.
          inspectorId: actor.user.id,
          result: data.result,
          defects: JSON.stringify(data.defects || []),
          notes: data.notes || null,
        },
      });
      const updatedRoll = await tx.roll.update({
        where: { id: roll.id },
        data: {
          qcStatus: data.result,
        },
        include: {
          order: true,
          machine: true,
          yarnLot: true,
        },
      });
      await recomputeQcStatus(tx, updatedRoll.orderId);
      return { qcRecord, updatedRoll };
    });

    await logAudit(
      "Roll",
      roll.id,
      "QC_INSPECT",
      { qcStatus: previousStatus },
      { qcStatus: data.result, defects: data.defects, notes: data.notes },
      actor.user.id
    );

    emit(RealtimeEvents.QcCompleted, {
      rollId: roll.id,
      rollNo: roll.rollNo,
      result: data.result,
      inspectorId: actor.user.id,
    });

    return NextResponse.json({
      success: true,
      qcRecord,
      roll: updatedRoll,
    });
  } catch (err: any) {
    console.error("Failed to submit QC inspection:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
