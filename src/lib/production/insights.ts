import type { PrismaClient } from "@prisma/client";
import { emit } from "@/lib/realtime";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHIFTS_PER_DAY = 2;
const REORDER_HORIZON_DAYS = 7;

export type DelayRisk = {
  orderId: string;
  orderNo: string;
  deadline: Date;
  estimatedDays: number | null;
  daysAvailable: number;
  reason: string;
};

export type ReorderSuggestion = {
  yarnTypeId: string;
  yarnName: string;
  stockKg: number;
  usageKgPerDay: number;
  daysLeft: number | null;
  reorderKg: number;
};

export function millDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (key: string) => parts.find((part) => part.type === key)?.value;
  const start = new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00+05:30`);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

export async function productionInsights(db: PrismaClient, now = new Date()) {
  const [orders, yarnTypes, logs] = await Promise.all([
    db.order.findMany({
      where: { status: "IN_PRODUCTION" },
      include: { workOrders: { include: { machine: true } } },
    }),
    db.yarnType.findMany({ include: { lots: true } }),
    db.productionLog.findMany({
      where: { loggedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) }, workOrder: { stage: "weaving" } },
      include: { workOrder: { include: { order: { include: { reservations: { include: { yarnLot: true } } } } } } },
    }),
  ]);

  const delayRisks: DelayRisk[] = [];
  for (const order of orders) {
    const daysAvailable = Math.max(0, (order.deadline.getTime() - now.getTime()) / DAY_MS);
    const stages = new Set(order.workOrders.map((workOrder) => workOrder.stage));
    const missingStage = ["spinning", "weaving", "dyeing"].find((stage) => !stages.has(stage));
    let estimatedDays = 0;
    let unavailable = false;
    for (const workOrder of order.workOrders) {
      const remaining = Math.max(0, workOrder.plannedQty - workOrder.producedQty);
      if (!remaining) continue;
      if (["BREAKDOWN", "MAINTENANCE"].includes(workOrder.machine.status)) {
        unavailable = true;
        continue;
      }
      estimatedDays += remaining / (workOrder.machine.capacityMetresPerShift * SHIFTS_PER_DAY);
    }
    if (missingStage || unavailable || estimatedDays > daysAvailable) {
      delayRisks.push({
        orderId: order.id,
        orderNo: order.orderNo,
        deadline: order.deadline,
        estimatedDays: missingStage || unavailable ? null : Math.ceil(estimatedDays * 10) / 10,
        daysAvailable: Math.ceil(daysAvailable * 10) / 10,
        reason: missingStage
          ? `${missingStage} has no work order`
          : unavailable
            ? "A scheduled machine is unavailable"
            : "Remaining work exceeds available shifts",
      });
    }
  }

  const usageByType = new Map<string, number>();
  for (const log of logs) {
    const order = log.workOrder.order;
    if (order.qtyMetres <= 0) continue;
    for (const reservation of order.reservations) {
      const dailyKg = (log.qtyProduced * reservation.qtyKg / order.qtyMetres) / 7;
      const yarnTypeId = reservation.yarnLot.yarnTypeId;
      usageByType.set(yarnTypeId, (usageByType.get(yarnTypeId) ?? 0) + dailyKg);
    }
  }

  const reorderSuggestions: ReorderSuggestion[] = [];
  for (const yarnType of yarnTypes) {
    const stockKg = yarnType.lots.reduce((total, lot) => total + lot.qtyRemainingKg, 0);
    const usageKgPerDay = usageByType.get(yarnType.id) ?? 0;
    const daysLeft = usageKgPerDay > 0 ? stockKg / usageKgPerDay : null;
    if (stockKg >= yarnType.lowStockThresholdKg && (daysLeft === null || daysLeft > REORDER_HORIZON_DAYS)) continue;
    const target = Math.max(yarnType.lowStockThresholdKg, usageKgPerDay * REORDER_HORIZON_DAYS);
    reorderSuggestions.push({
      yarnTypeId: yarnType.id,
      yarnName: `${yarnType.name} ${yarnType.count} ${yarnType.colour}`,
      stockKg: Math.round(stockKg * 10) / 10,
      usageKgPerDay: Math.round(usageKgPerDay * 10) / 10,
      daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10,
      reorderKg: Math.ceil(Math.max(0, target - stockKg)),
    });
  }
  return { delayRisks, reorderSuggestions };
}

// Called after production mutations. Alert identity is stable across recalculations;
// an unread alert is updated instead of producing a duplicate on each log entry.
export async function refreshProductionAlerts(db: PrismaClient) {
  const insights = await productionInsights(db);
  const active = new Set<string>();
  for (const risk of insights.delayRisks) {
    const type = `production_delay:${risk.orderId}`;
    active.add(type);
    const message = `${risk.orderNo} risks delay: ${risk.reason}. Deadline ${risk.deadline.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.`;
    await saveAlert(db, type, message, "warning");
  }
  for (const suggestion of insights.reorderSuggestions) {
    const type = `production_reorder:${suggestion.yarnTypeId}`;
    active.add(type);
    const message = `Reorder ${suggestion.reorderKg} kg of ${suggestion.yarnName}; ${suggestion.stockKg} kg remains${suggestion.daysLeft === null ? "" : ` (${suggestion.daysLeft} days at current usage)`}.`;
    await saveAlert(db, type, message, "warning");
  }
  const open = await db.notification.findMany({
    where: { read: false, OR: [{ type: { startsWith: "production_delay:" } }, { type: { startsWith: "production_reorder:" } }] },
    select: { id: true, type: true },
  });
  for (const alert of open) {
    if (!active.has(alert.type)) await db.notification.update({ where: { id: alert.id }, data: { read: true } });
  }
  return insights;
}

async function saveAlert(db: PrismaClient, type: string, message: string, severity: string) {
  const existing = await db.notification.findFirst({ where: { type, read: false } });
  if (existing?.message === message) return;
  const notification = existing
    ? await db.notification.update({ where: { id: existing.id }, data: { message, severity } })
    : await db.notification.create({ data: { type, message, severity } });
  await emit("notification:new", notification);
}
