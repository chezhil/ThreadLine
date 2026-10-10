import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qcInspectionSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import { recomputeQcStatus } from "@/lib/order-status";
import { enqueueAlert } from "@/lib/alerts/outbox";

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

    // Idempotency check for offline replay
    if (data.clientMutationId) {
      const existing = await db.qCRecord.findUnique({
        where: { id: data.clientMutationId },
        include: { roll: true },
      });
      if (existing) {
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

    // Conflict, not silent overwrite: this client queued its result against
    // an older qcStatus (e.g. while offline) and someone else inspected the
    // roll differently in the meantime. 409 so the offline queue can flag it
    // for review instead of applying a stale judgement or dropping it.
    if (data.baseQcStatus && data.baseQcStatus !== roll.qcStatus) {
      return NextResponse.json(
        {
          conflict: true,
          error: `This roll was inspected as ${roll.qcStatus} by someone else after you queued "${data.result}". Review and resubmit.`,
          currentQcStatus: roll.qcStatus,
        },
        { status: 409 }
      );
    }

    const previousStatus = roll.qcStatus;

    // Create the QC record, update the roll, and recompute the order-level
    // qcStatus aggregate, all atomically.
    const { qcRecord, updatedRoll, qcTransition } = await db.$transaction(async (tx) => {
      const qcRecord = await tx.qCRecord.create({
        data: {
          id: data.clientMutationId || undefined,
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
      const qcTransition = await recomputeQcStatus(tx, updatedRoll.orderId);
      return { qcRecord, updatedRoll, qcTransition };
    });

    // Buyer-facing push: the order just became ready to ship. Queued to the
    // delivery outbox, not sent inline — a failed send must never block or
    // re-run this QC write (see AlertDelivery in HARDENING_ADDENDUM.md item 6).
    if (qcTransition.to === "READY" && qcTransition.from !== "READY") {
      const orderWithBuyer = await db.order.findUnique({
        where: { id: updatedRoll.orderId },
        include: { buyer: true },
      });
      if (orderWithBuyer) {
        await enqueueAlert({
          channel: "WHATSAPP",
          recipient: orderWithBuyer.buyer.contact,
          templateName: "order_ready",
          payload: {
            orderNo: orderWithBuyer.orderNo,
            buyerName: orderWithBuyer.buyer.name,
            trackingPath: `/track/${orderWithBuyer.trackingToken}`,
          },
        });
      }
    }

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
