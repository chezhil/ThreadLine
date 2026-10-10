import { db } from "./db";
import { emit, RealtimeEvents } from "./realtime";

export async function totalRemainingKg(yarnTypeId: string): Promise<number> {
  const lots = await db.yarnLot.findMany({
    where: { yarnTypeId },
    select: { qtyRemainingKg: true },
  });
  return lots.reduce((sum, lot) => sum + lot.qtyRemainingKg, 0);
}

export async function checkLowStockAndNotify(yarnTypeId: string) {
  const yarnType = await db.yarnType.findUnique({ where: { id: yarnTypeId } });
  if (!yarnType) return;

  const remaining = await totalRemainingKg(yarnTypeId);
  emit(RealtimeEvents.StockChanged, { yarnTypeId, remainingKg: remaining });

  if (remaining <= yarnType.lowStockThresholdKg) {
    const notification = await db.notification.create({
      data: {
        type: "low_stock",
        message: `${yarnType.name} (${yarnType.colour}) is low: ${remaining.toFixed(1)}kg left, threshold ${yarnType.lowStockThresholdKg}kg.`,
        severity: "warning",
      },
    });
    emit(RealtimeEvents.NotificationNew, notification);
  }
}
