import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "../db";
import { WAGE_FACTOR, type AttendanceStatus } from "../validation/accounts";
import { istDateKey, istMonthKey, monthLabel } from "./period";

// True cost per order / per roll, computed only from rows other modules and
// Accounts have written. Nothing here is typed in by a person.
//
// Cost lines for an order:
//   yarn            Σ roll.weightKg × the roll's lot yarnType.costPerKg (rolls of every
//                   QC result — a rejected roll's yarn was still consumed)
//   processWastage  yarn lost in spinning/weaving that never reaches a roll:
//                   PROCESS_WASTAGE_PCT of roll yarn, same 8% default the order
//                   feasibility check uses
//   directWages     a worker's attendance mark on machine M, day D is paid to the
//                   orders M produced for on D, split by metres produced
//   power           each month's unlinked power bills, spread over that month's
//                   machine-shifts (one ProductionLog machine × day × shift = 1 unit)
//   overhead        same spread, for the month's unlinked overhead + other bills
//   indirectLabour  same spread, for wages of attendance marks not tied to a
//                   producing machine (helpers, fitters, store, idle machine)
//   directExpenses  expenses linked to this order (any category)
//
// Unlinked `yarn` bills are stock purchases (yarn is costed on consumption above)
// and unlinked `wages` bills are payroll payouts (wages are costed from
// attendance above) — neither is spread onto orders, or they'd be counted twice.

export const PROCESS_WASTAGE_PCT = 8;

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface OrderCostLines {
  yarn: number;
  processWastage: number;
  directWages: number;
  power: number;
  overhead: number;
  indirectLabour: number;
  directExpenses: number;
}

export interface OrderCosting {
  orderId: string;
  orderNo: string;
  buyerName: string;
  status: string;
  fabric: string;
  qtyMetres: number;
  pricePerMetre: number;
  createdAt: string;
  /** Contract: revenue = Order.pricePerMetre × Order.qtyMetres (ex-GST). */
  revenue: number;
  invoicedSubtotal: number;
  invoicedTotal: number;
  paid: number;
  outstanding: number;
  /** Date of the order's first invoice — the month its profit is booked in. */
  invoicedAt: string | null;
  costs: OrderCostLines;
  totalCost: number;
  profit: number;
  marginPct: number | null;
  /** Total cost ÷ metres actually rolled (null until a roll exists). */
  costPerMetre: number | null;
  /** final once invoiced or dispatched/closed; otherwise cost-to-date of work in progress. */
  stage: "final" | "in_progress";
  activeMonths: string[];
  dataGaps: string[];
  trace: {
    rolls: number;
    rollKg: number;
    rollMetres: number;
    rejectedRolls: number;
    rejectedRollKg: number;
    rejectedYarnCost: number;
    productionLogs: number;
    machineShiftUnits: number;
    directAttendanceMarks: number;
    linkedExpenses: number;
  };
}

export interface MonthPool {
  month: string;
  power: number;
  overhead: number;
  indirectLabour: number;
  machineShiftUnits: number;
  /** Pool money no order could absorb because nothing was produced that month. */
  unabsorbed: number;
}

export interface CostingResult {
  orders: OrderCosting[];
  pools: Record<string, MonthPool>;
}

const FINAL_STATUSES = new Set(["DISPATCHED", "CLOSED"]);

export async function computeCosting(db: PrismaClient = defaultDb): Promise<CostingResult> {
  const [orders, rolls, logs, attendance, expenses, invoices] = await Promise.all([
    db.order.findMany({ include: { buyer: { select: { name: true } } }, orderBy: { orderNo: "asc" } }),
    db.roll.findMany({
      select: {
        orderId: true,
        weightKg: true,
        lengthMetres: true,
        qcStatus: true,
        yarnLot: { select: { yarnType: { select: { costPerKg: true } } } },
      },
    }),
    db.productionLog.findMany({
      select: {
        machineId: true,
        shift: true,
        qtyProduced: true,
        loggedAt: true,
        workOrder: { select: { orderId: true } },
      },
    }),
    db.attendance.findMany({
      select: { date: true, status: true, machineId: true, worker: { select: { dailyWage: true } } },
    }),
    db.expense.findMany({ select: { category: true, amount: true, date: true, orderId: true } }),
    db.invoice.findMany({
      select: {
        orderId: true,
        subtotal: true,
        total: true,
        createdAt: true,
        payments: { select: { amount: true } },
      },
    }),
  ]);

  const acc = new Map<string, OrderCostLines>();
  const trace = new Map<string, OrderCosting["trace"]>();
  const months = new Map<string, Set<string>>();
  for (const o of orders) {
    acc.set(o.id, {
      yarn: 0,
      processWastage: 0,
      directWages: 0,
      power: 0,
      overhead: 0,
      indirectLabour: 0,
      directExpenses: 0,
    });
    trace.set(o.id, {
      rolls: 0,
      rollKg: 0,
      rollMetres: 0,
      rejectedRolls: 0,
      rejectedRollKg: 0,
      rejectedYarnCost: 0,
      productionLogs: 0,
      machineShiftUnits: 0,
      directAttendanceMarks: 0,
      linkedExpenses: 0,
    });
    months.set(o.id, new Set());
  }

  // --- Yarn, from rolls ---------------------------------------------------
  for (const roll of rolls) {
    const lines = acc.get(roll.orderId);
    const t = trace.get(roll.orderId);
    if (!lines || !t) continue;
    const cost = roll.weightKg * roll.yarnLot.yarnType.costPerKg;
    lines.yarn += cost;
    lines.processWastage += (cost * PROCESS_WASTAGE_PCT) / 100;
    t.rolls += 1;
    t.rollKg += roll.weightKg;
    t.rollMetres += roll.lengthMetres;
    if (roll.qcStatus === "REJECT") {
      t.rejectedRolls += 1;
      t.rejectedRollKg += roll.weightKg;
      t.rejectedYarnCost += cost;
    }
  }

  // --- Machine-shifts and machine-days, from production logs --------------
  // machine-shift → { month, qty by order }; machine-day → qty by order
  const shiftKeys = new Map<string, { month: string; total: number; byOrder: Map<string, number> }>();
  const dayKeys = new Map<string, { total: number; byOrder: Map<string, number> }>();
  for (const log of logs) {
    const orderId = log.workOrder.orderId;
    if (!acc.has(orderId) || log.qtyProduced <= 0) continue;
    const date = istDateKey(log.loggedAt);
    const month = istMonthKey(log.loggedAt);
    months.get(orderId)!.add(month);
    trace.get(orderId)!.productionLogs += 1;

    const sKey = `${log.machineId}|${date}|${log.shift.trim().toLowerCase()}`;
    const s = shiftKeys.get(sKey) ?? { month, total: 0, byOrder: new Map() };
    s.total += log.qtyProduced;
    s.byOrder.set(orderId, (s.byOrder.get(orderId) ?? 0) + log.qtyProduced);
    shiftKeys.set(sKey, s);

    const dKey = `${log.machineId}|${date}`;
    const d = dayKeys.get(dKey) ?? { total: 0, byOrder: new Map() };
    d.total += log.qtyProduced;
    d.byOrder.set(orderId, (d.byOrder.get(orderId) ?? 0) + log.qtyProduced);
    dayKeys.set(dKey, d);
  }

  // order → month → machine-shift units
  const unitsByOrderMonth = new Map<string, Map<string, number>>();
  const pools: Record<string, MonthPool> = {};
  const pool = (month: string) =>
    (pools[month] ??= {
      month,
      power: 0,
      overhead: 0,
      indirectLabour: 0,
      machineShiftUnits: 0,
      unabsorbed: 0,
    });

  for (const s of shiftKeys.values()) {
    pool(s.month).machineShiftUnits += 1;
    for (const [orderId, qty] of s.byOrder) {
      const share = qty / s.total;
      const m = unitsByOrderMonth.get(orderId) ?? new Map<string, number>();
      m.set(s.month, (m.get(s.month) ?? 0) + share);
      unitsByOrderMonth.set(orderId, m);
      trace.get(orderId)!.machineShiftUnits += share;
    }
  }

  // --- Wages, from attendance ----------------------------------------------
  for (const mark of attendance) {
    const wage = mark.worker.dailyWage * (WAGE_FACTOR[mark.status as AttendanceStatus] ?? 0);
    if (wage <= 0) continue;
    const day = mark.machineId ? dayKeys.get(`${mark.machineId}|${istDateKey(mark.date)}`) : undefined;
    if (!day) {
      pool(istMonthKey(mark.date)).indirectLabour += wage;
      continue;
    }
    for (const [orderId, qty] of day.byOrder) {
      acc.get(orderId)!.directWages += (wage * qty) / day.total;
      trace.get(orderId)!.directAttendanceMarks += 1;
    }
  }

  // --- Expenses --------------------------------------------------------------
  for (const e of expenses) {
    if (e.orderId && acc.has(e.orderId)) {
      acc.get(e.orderId)!.directExpenses += e.amount;
      trace.get(e.orderId)!.linkedExpenses += 1;
      months.get(e.orderId)!.add(istMonthKey(e.date));
      continue;
    }
    if (e.category === "power") pool(istMonthKey(e.date)).power += e.amount;
    else if (e.category === "overhead" || e.category === "other") pool(istMonthKey(e.date)).overhead += e.amount;
    // unlinked yarn / wages: deliberately not spread (see header comment)
  }

  // --- Spread month pools over machine-shifts --------------------------------
  for (const p of Object.values(pools)) {
    if (p.machineShiftUnits === 0) {
      p.unabsorbed = p.power + p.overhead + p.indirectLabour;
    }
  }
  for (const [orderId, byMonth] of unitsByOrderMonth) {
    const lines = acc.get(orderId)!;
    for (const [month, units] of byMonth) {
      const p = pools[month];
      const share = units / p.machineShiftUnits;
      lines.power += p.power * share;
      lines.overhead += p.overhead * share;
      lines.indirectLabour += p.indirectLabour * share;
    }
  }

  // --- Revenue, invoices, payments -------------------------------------------
  const inv = new Map<string, { subtotal: number; total: number; paid: number; first: Date | null }>();
  for (const i of invoices) {
    const cur = inv.get(i.orderId) ?? { subtotal: 0, total: 0, paid: 0, first: null };
    cur.subtotal += i.subtotal;
    cur.total += i.total;
    cur.paid += i.payments.reduce((s, p) => s + p.amount, 0);
    if (!cur.first || i.createdAt < cur.first) cur.first = i.createdAt;
    inv.set(i.orderId, cur);
  }

  const result: OrderCosting[] = orders.map((o) => {
    const lines = acc.get(o.id)!;
    const t = trace.get(o.id)!;
    const i = inv.get(o.id);
    const totalCost = Object.values(lines).reduce((s, n) => s + n, 0);
    const revenue = o.qtyMetres * o.pricePerMetre;
    const profit = revenue - totalCost;
    const activeMonths = months.get(o.id)!;
    activeMonths.add(istMonthKey(o.createdAt));
    if (i?.first) activeMonths.add(istMonthKey(i.first));

    const dataGaps: string[] = [];
    if (t.rolls === 0) dataGaps.push("No rolls recorded for this order yet, so yarn cost is ₹0.");
    if (t.productionLogs === 0)
      dataGaps.push("No production logged for this order yet, so no wages, power or overhead are allocated.");
    for (const m of unitsByOrderMonth.get(o.id)?.keys() ?? []) {
      if (pools[m].power === 0) dataGaps.push(`No power bill recorded for ${monthLabel(m)}, so power cost is ₹0 for that month.`);
    }

    return {
      orderId: o.id,
      orderNo: o.orderNo,
      buyerName: o.buyer.name,
      status: o.status,
      fabric: `${o.fabricType} · ${o.colour} · ${o.gsm} GSM`,
      qtyMetres: o.qtyMetres,
      pricePerMetre: o.pricePerMetre,
      createdAt: o.createdAt.toISOString(),
      revenue: r2(revenue),
      invoicedSubtotal: r2(i?.subtotal ?? 0),
      invoicedTotal: r2(i?.total ?? 0),
      paid: r2(i?.paid ?? 0),
      outstanding: r2((i?.total ?? 0) - (i?.paid ?? 0)),
      invoicedAt: i?.first ? i.first.toISOString() : null,
      costs: {
        yarn: r2(lines.yarn),
        processWastage: r2(lines.processWastage),
        directWages: r2(lines.directWages),
        power: r2(lines.power),
        overhead: r2(lines.overhead),
        indirectLabour: r2(lines.indirectLabour),
        directExpenses: r2(lines.directExpenses),
      },
      totalCost: r2(totalCost),
      profit: r2(profit),
      marginPct: revenue > 0 ? r2((profit / revenue) * 100) : null,
      costPerMetre: t.rollMetres > 0 ? r2(totalCost / t.rollMetres) : null,
      stage: i || FINAL_STATUSES.has(o.status) ? "final" : "in_progress",
      activeMonths: [...activeMonths].sort(),
      dataGaps,
      trace: {
        ...t,
        rollKg: r2(t.rollKg),
        rollMetres: r2(t.rollMetres),
        rejectedRollKg: r2(t.rejectedRollKg),
        rejectedYarnCost: r2(t.rejectedYarnCost),
        machineShiftUnits: r2(t.machineShiftUnits),
      },
    };
  });

  for (const p of Object.values(pools)) {
    p.power = r2(p.power);
    p.overhead = r2(p.overhead);
    p.indirectLabour = r2(p.indirectLabour);
    p.unabsorbed = r2(p.unabsorbed);
  }

  return { orders: result, pools };
}

/** Orders whose profit is booked in `month`: first invoiced in that month. */
export function ordersRealisedIn(orders: OrderCosting[], month: string): OrderCosting[] {
  return orders.filter((o) => o.invoicedAt && istMonthKey(new Date(o.invoicedAt)) === month);
}

/** Orders still in progress that had any activity in `month`. */
export function ordersInProgressIn(orders: OrderCosting[], month: string): OrderCosting[] {
  return orders.filter((o) => o.stage === "in_progress" && o.activeMonths.includes(month));
}

export interface RollCost {
  rollId: string;
  rollNo: string;
  qcStatus: string;
  lengthMetres: number;
  weightKg: number;
  lotNo: string;
  machineName: string;
  shift: string;
  yarnCost: number;
  conversionCost: number;
  totalCost: number;
  costPerMetre: number;
}

/**
 * Cost per roll for one order: each roll's own yarn (+ process wastage) plus a
 * share of the order's conversion cost (wages, power, overhead, direct
 * expenses) in proportion to its length.
 */
export async function rollCostsForOrder(
  order: OrderCosting,
  db: PrismaClient = defaultDb,
): Promise<RollCost[]> {
  const rolls = await db.roll.findMany({
    where: { orderId: order.orderId },
    include: { yarnLot: { include: { yarnType: true } }, machine: { select: { name: true } } },
    orderBy: { rollNo: "asc" },
  });
  const c = order.costs;
  const conversion = c.directWages + c.power + c.overhead + c.indirectLabour + c.directExpenses;
  const totalLength = rolls.reduce((s, r) => s + r.lengthMetres, 0);
  return rolls.map((r) => {
    const yarn = r.weightKg * r.yarnLot.yarnType.costPerKg * (1 + PROCESS_WASTAGE_PCT / 100);
    const conv = totalLength > 0 ? (conversion * r.lengthMetres) / totalLength : 0;
    return {
      rollId: r.id,
      rollNo: r.rollNo,
      qcStatus: r.qcStatus,
      lengthMetres: r.lengthMetres,
      weightKg: r.weightKg,
      lotNo: r.yarnLot.lotNo,
      machineName: r.machine.name,
      shift: r.shift,
      yarnCost: r2(yarn),
      conversionCost: r2(conv),
      totalCost: r2(yarn + conv),
      costPerMetre: r.lengthMetres > 0 ? r2((yarn + conv) / r.lengthMetres) : 0,
    };
  });
}
