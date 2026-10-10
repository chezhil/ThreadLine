import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { qcReversalSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, emitDataChanged, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import { recomputeRollAggregates, recordStatusChanges } from "@/lib/order-status";
import { queueOrderReadyAlert } from "@/lib/alerts/order-alerts";
import { AlreadyReversed, notReversed, reverseRecord } from "@/lib/reversals";

type Ctx = { params: Promise<{ id: string; recordId: string }> };

class ReversalRefused extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

// POST { reason } — reverses a wrong inspection (owner and QC). The record
// stays in the roll's history marked reversed; the roll goes back to the grade
// of its latest remaining inspection (PENDING if none), and the order's QC and
// dispatch status follow. To correct it, inspect the roll again as usual.
// A dispatched roll's grade is final.
export async function POST(req: NextRequest, { params }: Ctx) {
  const actor = await qualityActor("owner", "qc_inspector");
  if ("response" in actor) return actor.response;
  const { id: rollId, recordId } = await params;
  const parsed = qcReversalSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return handleZodError(parsed.error);

  let result;
  try {
    result = await writeTransaction(async (tx) => {
      const record = await tx.qCRecord.findUnique({ where: { id: recordId }, include: { roll: true } });
      if (!record || record.rollId !== rollId) throw new ReversalRefused("Inspection not found on this roll", 404);
      if (record.roll.dispatchId) throw new ReversalRefused("This roll has been dispatched; its grade is final", 409);
      await reverseRecord(tx, { source: "QCRecord", id: recordId, reason: parsed.data.reason, userId: actor.user.id });

      const latest = await tx.qCRecord.findFirst({
        where: { rollId, ...notReversed },
        orderBy: { inspectedAt: "desc" },
        select: { result: true },
      });
      const qcStatus = latest?.result ?? "PENDING";
      const claimed = await tx.roll.updateMany({ where: { id: rollId, dispatchId: null }, data: { qcStatus } });
      if (claimed.count !== 1) throw new ReversalRefused("This roll was just dispatched; its grade is final", 409);
      const statusChange = await recomputeRollAggregates(tx, record.roll.orderId);
      await queueOrderReadyAlert(tx, statusChange);
      return { roll: record.roll, record, qcStatus, statusChange };
    });
  } catch (err) {
    if (err instanceof ReversalRefused) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof AlreadyReversed) return NextResponse.json({ error: "This inspection was already reversed" }, { status: 409 });
    throw err;
  }

  await logAudit(
    "Roll",
    rollId,
    "QC_REVERSE",
    { qcStatus: result.roll.qcStatus, reversedInspection: { id: recordId, result: result.record.result } },
    { qcStatus: result.qcStatus, reason: parsed.data.reason },
    actor.user.id,
  );
  await recordStatusChanges([result.statusChange], actor.user.id);
  emit(RealtimeEvents.QcCompleted, { rollId, rollNo: result.roll.rollNo, result: result.qcStatus });
  emitDataChanged({ entity: "QCRecord", id: recordId, action: "reverse" });
  return NextResponse.json({ rollId, qcStatus: result.qcStatus }, { status: 201 });
}
