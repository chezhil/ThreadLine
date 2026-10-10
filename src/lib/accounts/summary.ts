import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "../db";
import { EXPENSE_CATEGORIES, WAGE_FACTOR, type AttendanceStatus } from "../validation/accounts";
import { computeCosting, ordersInProgressIn, ordersRealisedIn, type CostingResult } from "./costing";
import { monthLabel, monthRange } from "./period";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MonthSummary {
  month: string;
  label: string;
  /** Accrual view: profit booked on orders first invoiced this month. */
  pnl: {
    ordersRealised: number;
    revenue: number;
    costOfOrders: number;
    grossProfit: number;
    /** This month's power/overhead/indirect wages that no production absorbed. */
    unabsorbedPeriodCost: number;
    netProfit: number;
    marginPct: number | null;
  };
  workInProgress: { orders: number; costToDate: number };
  /** Cash and bills view of the month. */
  cash: {
    paymentsReceived: number;
    paymentsCount: number;
    gstInvoiced: number;
    invoicedTotal: number;
    invoicesCount: number;
    expensesByCategory: Record<string, number>;
    expensesTotal: number;
  };
  wages: {
    accrued: number;
    workers: number;
    presentDays: number;
    halfDays: number;
    absentDays: number;
  };
  receivables: { outstanding: number; invoicesOpen: number };
  pool: { power: number; overhead: number; indirectLabour: number; machineShiftUnits: number } | null;
}

export async function monthSummary(
  month: string,
  db: PrismaClient = defaultDb,
  costing?: CostingResult,
): Promise<MonthSummary> {
  const { start, end } = monthRange(month);
  const inMonth = { gte: start, lt: end };
  const [c, payments, expenses, attendance, monthInvoices, allInvoices] = await Promise.all([
    costing ?? computeCosting(db),
    db.payment.findMany({ where: { receivedAt: inMonth }, select: { amount: true } }),
    db.expense.findMany({ where: { date: inMonth }, select: { category: true, amount: true } }),
    db.attendance.findMany({
      where: { date: inMonth },
      select: { workerId: true, status: true, worker: { select: { dailyWage: true } } },
    }),
    db.invoice.findMany({ where: { createdAt: inMonth }, select: { gst: true, total: true } }),
    db.invoice.findMany({ select: { total: true, payments: { select: { amount: true } } } }),
  ]);

  const realised = ordersRealisedIn(c.orders, month);
  const wip = ordersInProgressIn(c.orders, month);
  const revenue = realised.reduce((s, o) => s + o.revenue, 0);
  const costOfOrders = realised.reduce((s, o) => s + o.totalCost, 0);
  const pool = c.pools[month];
  const unabsorbed = pool?.unabsorbed ?? 0;
  const netProfit = revenue - costOfOrders - unabsorbed;

  const expensesByCategory: Record<string, number> = Object.fromEntries(
    EXPENSE_CATEGORIES.map((k) => [k, 0]),
  );
  for (const e of expenses) expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amount;

  let accrued = 0;
  let presentDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  for (const a of attendance) {
    accrued += a.worker.dailyWage * (WAGE_FACTOR[a.status as AttendanceStatus] ?? 0);
    if (a.status === "present") presentDays++;
    else if (a.status === "half_day") halfDays++;
    else absentDays++;
  }

  let outstanding = 0;
  let invoicesOpen = 0;
  for (const i of allInvoices) {
    const due = i.total - i.payments.reduce((s, p) => s + p.amount, 0);
    if (due > 0.005) {
      outstanding += due;
      invoicesOpen++;
    }
  }

  return {
    month,
    label: monthLabel(month),
    pnl: {
      ordersRealised: realised.length,
      revenue: r2(revenue),
      costOfOrders: r2(costOfOrders),
      grossProfit: r2(revenue - costOfOrders),
      unabsorbedPeriodCost: r2(unabsorbed),
      netProfit: r2(netProfit),
      marginPct: revenue > 0 ? r2((netProfit / revenue) * 100) : null,
    },
    workInProgress: { orders: wip.length, costToDate: r2(wip.reduce((s, o) => s + o.totalCost, 0)) },
    cash: {
      paymentsReceived: r2(payments.reduce((s, p) => s + p.amount, 0)),
      paymentsCount: payments.length,
      gstInvoiced: r2(monthInvoices.reduce((s, i) => s + i.gst, 0)),
      invoicedTotal: r2(monthInvoices.reduce((s, i) => s + i.total, 0)),
      invoicesCount: monthInvoices.length,
      expensesByCategory: Object.fromEntries(
        Object.entries(expensesByCategory).map(([k, v]) => [k, r2(v)]),
      ),
      expensesTotal: r2(expenses.reduce((s, e) => s + e.amount, 0)),
    },
    wages: {
      accrued: r2(accrued),
      workers: new Set(attendance.map((a) => a.workerId)).size,
      presentDays,
      halfDays,
      absentDays,
    },
    receivables: { outstanding: r2(outstanding), invoicesOpen },
    pool: pool
      ? {
          power: pool.power,
          overhead: pool.overhead,
          indirectLabour: pool.indirectLabour,
          machineShiftUnits: pool.machineShiftUnits,
        }
      : null,
  };
}
