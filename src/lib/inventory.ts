import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { emit, RealtimeEvents } from "./realtime";
import { writeTransaction } from "./concurrency";

export async function totalRemainingKg(yarnTypeId: string): Promise<number> {
  const lots = await db.yarnLot.findMany({
    where: { yarnTypeId },
    select: { qtyRemainingKg: true },
  });
  return lots.reduce((sum, lot) => sum + lot.qtyRemainingKg, 0);
}

/** Closes the yarn type's open low-stock alert, if any (refilled, archived or
 * deleted), so the next shortage raises a fresh one. */
export async function resolveLowStockAlert(tx: Prisma.TransactionClient, yarnTypeId: string) {
  const type = `low_stock:${yarnTypeId}`;
  const open = await tx.notification.findFirst({ where: { type, read: false } });
  if (open) {
    await tx.notification.update({ where: { id: open.id }, data: { read: true, type: `${type}:cleared:${Date.now()}` } });
  }
}

// One open low-stock alert per yarn type: a further reservation updates its
// figure instead of piling up another alert, and a refill above the
// threshold resolves it (so the next shortage raises a fresh one). Same
// episode pattern as the derived alerts in accounts/alerts.ts. An archived
// yarn type is no longer stocked, so it never shows as low.
export async function checkLowStockAndNotify(yarnTypeId: string) {
  const yarnType = await db.yarnType.findUnique({ where: { id: yarnTypeId } });
  if (!yarnType) return;

  const remaining = await totalRemainingKg(yarnTypeId);
  emit(RealtimeEvents.StockChanged, { yarnTypeId, remainingKg: remaining });

  const type = `low_stock:${yarnTypeId}`;
  const low = !yarnType.archivedAt && remaining <= yarnType.lowStockThresholdKg;
  const message = `${yarnType.name} (${yarnType.colour}) is low: ${remaining.toFixed(1)}kg left, threshold ${yarnType.lowStockThresholdKg}kg.`;

  const raised = await writeTransaction(async (tx) => {
    if (!low) {
      await resolveLowStockAlert(tx, yarnTypeId);
      return null;
    }
    const open = await tx.notification.findFirst({ where: { type, read: false } });
    if (open) {
      if (open.message === message) return null;
      // A changed figure is news to everyone again.
      await tx.notificationRead.deleteMany({ where: { notificationId: open.id } });
      return tx.notification.update({ where: { id: open.id }, data: { message, createdAt: new Date() } });
    }
    return tx.notification.create({ data: { type, message, severity: "warning" } });
  });
  if (raised) emit(RealtimeEvents.NotificationNew, raised);
}
