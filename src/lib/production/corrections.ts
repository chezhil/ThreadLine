import type { Prisma } from "@prisma/client";
import { FINAL_STAGE, syncProductionStatus, type StatusChange } from "@/lib/order-status";
import { millDayRange } from "./insights";

// Correcting or removing a production log: the work order's produced metres
// move by the difference, which can complete or reopen it — and reopening the
// final stage reopens the order's production. Runs inside the caller's write
// transaction.

const EPSILON = 0.000001;
const STAGES = ["spinning", "weaving", "dyeing"];

export class CorrectionRefused extends Error {
  constructor(
    public field: string,
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

export interface LogCorrection {
  /** The corrected quantity; 0 together with remove: true deletes the log. */
  qtyProduced: number;
  shift?: string;
  remove: boolean;
}

export async function correctProductionLog(tx: Prisma.TransactionClient, logId: string, correction: LogCorrection) {
  const log = await tx.productionLog.findUnique({
    where: { id: logId },
    include: { workOrder: { include: { order: true } }, machine: true },
  });
  if (!log) return null;
  const { workOrder } = log;
  const { order } = workOrder;
  if (order.status === "DISPATCHED" || order.status === "CLOSED") {
    throw new CorrectionRefused("_form", `${order.orderNo} has ${order.status === "CLOSED" ? "closed" : "fully shipped"}; its production record is final`);
  }

  const shift = correction.shift ?? log.shift;
  if (!correction.remove) {
    // Same rated-output bound as logging, for the day the output was made.
    const { start, end } = millDayRange(log.loggedAt);
    const others = await tx.productionLog.aggregate({
      where: { machineId: log.machineId, shift, loggedAt: { gte: start, lt: end }, NOT: { id: log.id } },
      _sum: { qtyProduced: true },
    });
    const otherQty = others._sum.qtyProduced ?? 0;
    if (otherQty + correction.qtyProduced > log.machine.capacityMetresPerShift + EPSILON) {
      throw new CorrectionRefused(
        "qtyProduced",
        `${log.machine.name} makes at most ${log.machine.capacityMetresPerShift} m per shift` +
          (otherQty ? `; ${otherQty} m is already logged for ${shift} that day` : ""),
        400,
      );
    }
  }

  const producedQty = workOrder.producedQty - log.qtyProduced + correction.qtyProduced;
  if (producedQty > workOrder.plannedQty + EPSILON) {
    throw new CorrectionRefused("qtyProduced", `That would take ${workOrder.stage} past its planned ${workOrder.plannedQty} m`, 400);
  }
  const wasCompleted = workOrder.status === "COMPLETED";
  const completed = producedQty >= workOrder.plannedQty - EPSILON;
  if (wasCompleted && !completed) {
    // The next stage was only allowed to start because this one finished.
    const later = STAGES.slice(STAGES.indexOf(workOrder.stage) + 1);
    const next = await tx.workOrder.findFirst({ where: { orderId: order.id, stage: { in: later } }, select: { stage: true } });
    if (next) {
      throw new CorrectionRefused(
        "_form",
        `This would reopen ${workOrder.stage}, but ${next.stage} has already started on the strength of it. Correct the ${next.stage} work first.`,
      );
    }
  }

  const remainingLogs = correction.remove ? await tx.productionLog.count({ where: { workOrderId: workOrder.id, NOT: { id: log.id } } }) : 1;
  // Conditional on the figure read above, so two corrections at once can't
  // both apply their difference to the same starting total.
  const changed = await tx.workOrder.updateMany({
    where: { id: workOrder.id, producedQty: workOrder.producedQty },
    data: {
      producedQty: Math.max(0, producedQty),
      status: completed ? "COMPLETED" : remainingLogs > 0 ? "IN_PROGRESS" : "PLANNED",
      startedAt: remainingLogs > 0 ? workOrder.startedAt : null,
      finishedAt: completed ? (workOrder.finishedAt ?? new Date()) : null,
    },
  });
  if (changed.count !== 1) throw new CorrectionRefused("qtyProduced", "Output changed while you were correcting it; refresh and try again");

  let after = null;
  if (correction.remove) await tx.productionLog.delete({ where: { id: log.id } });
  else after = await tx.productionLog.update({ where: { id: log.id }, data: { qtyProduced: correction.qtyProduced, shift } });

  let statusChange: StatusChange | null = null;
  if (workOrder.stage === FINAL_STAGE && wasCompleted !== completed) {
    statusChange = await syncProductionStatus(tx, order.id);
  }

  const { workOrder: _wo, machine: _machine, ...before } = log;
  void _wo;
  void _machine;
  return {
    before,
    after,
    machineId: log.machineId,
    machineStatus: log.machine.status,
    workOrder: { id: workOrder.id, from: workOrder.producedQty, to: producedQty },
    statusChange,
  };
}
