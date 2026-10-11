import type { PrismaClient } from "@prisma/client";
import { emit } from "@/lib/realtime";
import { writeTransaction } from "@/lib/concurrency";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHIFTS_PER_DAY = 2;
const REORDER_HORIZON_DAYS = 7;
const STAGES = ["spinning", "weaving", "dyeing"] as const;
const MACHINE_TYPE: Record<(typeof STAGES)[number], string> = { spinning: "spinning", weaving: "loom", dyeing: "dyeing" };

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
  const [orders, yarnTypes, logs, machines] = await Promise.all([
    db.order.findMany({
      where: { productionStatus: "IN_PRODUCTION", status: { not: "CLOSED" } },
      include: { workOrders: { include: { machine: true } } },
    }),
    db.yarnType.findMany({ where: { archivedAt: null }, include: { lots: true } }),
    db.productionLog.findMany({
      where: { loggedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) }, workOrder: { stage: "weaving" } },
      include: { workOrder: { include: { order: { include: { reservations: { include: { yarnLot: true } } } } } } },
    }),
    db.machine.findMany({ select: { type: true, status: true, capacityMetresPerShift: true } }),
  ]);
  // Best available machine per type, for stages that have no work order yet.
  const bestCapacity = new Map<string, number>();
  for (const m of machines) {
    if (m.status === "BREAKDOWN" || m.status === "MAINTENANCE") continue;
    bestCapacity.set(m.type, Math.max(bestCapacity.get(m.type) ?? 0, m.capacityMetresPerShift));
  }

  const delayRisks: DelayRisk[] = [];
  for (const order of orders) {
    const daysAvailable = Math.max(0, (order.deadline.getTime() - now.getTime()) / DAY_MS);
    // A stage is "missing" only when the one before it is finished and nobody
    // has created its work order — stages simply not reached yet are normal
    // (and seeded orders that skip spinning are not at risk for that).
    const byStage = new Map(order.workOrders.map((workOrder) => [workOrder.stage, workOrder]));
    const missingStage = STAGES.find((stage, i) => i > 0 && !byStage.has(stage) && byStage.get(STAGES[i - 1])?.status === "COMPLETED");
    let estimatedDays = 0;
    let unavailable = false;
    // Stages after the latest one that exists still have to run in full.
    const lastIndex = Math.max(...STAGES.map((stage, i) => (byStage.has(stage) ? i : -1)));
    for (const stage of STAGES.slice(lastIndex + 1)) {
      const capacity = bestCapacity.get(MACHINE_TYPE[stage]);
      if (!capacity) unavailable = true;
      else estimatedDays += order.qtyMetres / (capacity * SHIFTS_PER_DAY);
    }
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
          ? `${missingStage} is ready to start but has no work order`
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
// The whole read-check-write pass runs inside one transaction so two near-
// simultaneous callers (e.g. two floor supervisors logging output at once)
// can't both see "no open alert yet" and both insert one (same race the
// derived-alerts sync in ../accounts/alerts.ts had — see its comment).
export async function refreshProductionAlerts(db: PrismaClient) {
  const insights = await productionInsights(db);
  const desired = new Map<string, string>();
  for (const risk of insights.delayRisks) {
    desired.set(
      `production_delay:${risk.orderId}`,
      `${risk.orderNo} risks delay: ${risk.reason}. Deadline ${risk.deadline.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}.`,
    );
  }
  for (const suggestion of insights.reorderSuggestions) {
    desired.set(
      `production_reorder:${suggestion.yarnTypeId}`,
      `Reorder ${suggestion.reorderKg} kg of ${suggestion.yarnName}; ${suggestion.stockKg} kg remains${suggestion.daysLeft === null ? "" : ` (${suggestion.daysLeft} days at current usage)`}.`,
    );
  }
  // One read and one bulk insert instead of a query per alert: this runs after
  // every production write inside the (serialised) write queue, and with a few
  // hundred open orders over a remote database the per-alert round trips ran
  // past the transaction timeout and stalled every other write behind it.
  const notifications = await writeTransaction(db, async (tx) => {
    const open = await tx.notification.findMany({
      where: { read: false, OR: [{ type: { startsWith: "production_delay:" } }, { type: { startsWith: "production_reorder:" } }] },
      select: { id: true, type: true, message: true },
    });
    const openByType = new Map(open.map((n) => [n.type, n]));
    const changed: Array<{ id: string }> = [];
    const fresh: Array<{ type: string; message: string; severity: string }> = [];
    for (const [type, message] of desired) {
      const existing = openByType.get(type);
      if (!existing) fresh.push({ type, message, severity: "warning" });
      else if (existing.message !== message) {
        changed.push(await tx.notification.update({ where: { id: existing.id }, data: { message, severity: "warning" } }));
      }
    }
    const created = fresh.length ? await tx.notification.createManyAndReturn({ data: fresh }) : [];
    const cleared = open.filter((n) => !desired.has(n.type)).map((n) => n.id);
    if (cleared.length) await tx.notification.updateMany({ where: { id: { in: cleared } }, data: { read: true } });
    return [...changed, ...created];
  });
  for (const n of notifications) await emit("notification:new", n);
  return insights;
}
