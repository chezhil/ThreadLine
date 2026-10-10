import { NextRequest, NextResponse } from "next/server";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { checkLowStockAndNotify } from "@/lib/inventory";
import { forbidden, notFound } from "@/lib/accounts/http";
import { inUse } from "@/lib/in-use";

type Ctx = { params: Promise<{ id: string; reservationId: string }> };

// DELETE — releases a yarn reservation back to its lot (owner and
// storekeeper, the roles that reserve). Only before production starts: once
// it has, nothing records how much of the reserved yarn was consumed, so
// handing it back could double-count stock.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();
  const { id: orderId, reservationId } = await params;

  const result = await writeTransaction(async (tx) => {
    const reservation = await tx.orderYarnReservation.findUnique({
      where: { id: reservationId },
      include: { order: { select: { orderNo: true, productionStatus: true, status: true } }, yarnLot: true },
    });
    if (!reservation || reservation.orderId !== orderId) return { status: "missing" as const };
    const { order, yarnLot } = reservation;
    if (order.productionStatus !== "NOT_STARTED" || order.status === "CLOSED") {
      return { status: "started" as const, orderNo: order.orderNo };
    }
    await tx.orderYarnReservation.delete({ where: { id: reservationId } });
    const lot = await tx.yarnLot.update({
      where: { id: yarnLot.id },
      data: { qtyRemainingKg: Math.min(yarnLot.qtyReceivedKg, yarnLot.qtyRemainingKg + reservation.qtyKg) },
    });
    const { order: _order, yarnLot: _lot, ...snapshot } = reservation;
    void _order;
    void _lot;
    return { status: "released" as const, snapshot, yarnTypeId: lot.yarnTypeId };
  });
  if (result.status === "missing") return notFound("Reservation not found on this order");
  if (result.status === "started") {
    return inUse(`Production on ${result.orderNo} has started, so its reserved yarn can no longer be released.`);
  }

  await logAudit("OrderYarnReservation", reservationId, "release", result.snapshot, null, user.id);
  await checkLowStockAndNotify(result.yarnTypeId);
  emitDataChanged({ entity: "OrderYarnReservation", id: reservationId, action: "delete" });
  return NextResponse.json({ ok: true });
}
