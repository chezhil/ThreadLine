import { z } from "zod";
import { syncDerivedAlerts } from "../accounts/alerts";
import { db } from "../db";
import { notReversed } from "../reversals";
import { computeCosting, ordersInProgressIn, ordersRealisedIn } from "../accounts/costing";
import { machineOutput, machineQuality } from "../accounts/machine-output";
import { currentMonthKey, MONTH_PATTERN, monthLabel, monthRange } from "../accounts/period";
import { monthSummary } from "../accounts/summary";
import { WAGE_FACTOR, type AttendanceStatus } from "../validation/accounts";

// The ONLY things the owner assistant can run. Each tool is a fixed, read-only
// Prisma query with zod-validated arguments; the model picks a tool and fills
// its arguments, it never writes SQL or touches the DB itself.

const r2 = (n: number) => Math.round(n * 100) / 100;
const month = z
  .string()
  .regex(MONTH_PATTERN, "month must be YYYY-MM")
  .optional()
  .describe("Calendar month as YYYY-MM. Omit for the current month.");

export interface AssistantTool<A extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  args: A;
  run: (args: z.infer<A>) => Promise<unknown>;
}

function tool<A extends z.ZodTypeAny>(t: AssistantTool<A>): AssistantTool<A> {
  return t;
}

export const TOOLS = [
  tool({
    name: "profitByOrder",
    description:
      "Profit per order for a month: orders that finished (fully dispatched or closed) in that month with revenue, true cost, profit and margin, sorted lowest profit first; plus in-progress orders' cost to date. Use for least/most profitable order, loss-making orders, order profit this month.",
    args: z.object({ month }),
    run: async ({ month: m }) => {
      const mm = m ?? currentMonthKey();
      const { orders } = await computeCosting();
      const pick = (o: (typeof orders)[number]) => ({
        orderNo: o.orderNo,
        buyer: o.buyerName,
        status: o.status,
        revenue: o.revenue,
        totalCost: o.totalCost,
        profit: o.profit,
        marginPct: o.marginPct,
        dataGaps: o.dataGaps,
      });
      return {
        month: mm,
        monthLabel: monthLabel(mm),
        realisedOrders: ordersRealisedIn(orders, mm).map(pick).sort((a, b) => a.profit - b.profit),
        inProgressOrders: ordersInProgressIn(orders, mm).map((o) => ({
          orderNo: o.orderNo,
          buyer: o.buyerName,
          status: o.status,
          costToDate: o.totalCost,
          orderValue: o.revenue,
        })),
        basis:
          "An order's profit is booked in the month it finished (its last truck left, or it was closed). Revenue = qty × price per metre (ex-GST). Cost = yarn from rolls + 8% process wastage + wages from attendance + power/overhead spread by machine-shifts + expenses linked to the order.",
      };
    },
  }),
  tool({
    name: "orderCost",
    description:
      "Full cost breakdown for one order by order number (e.g. EVR-2610-004): yarn, wastage, wages, power, overhead, direct expenses, revenue, profit, invoiced, paid, and any data gaps.",
    args: z.object({ orderNo: z.string().trim().min(3).describe("Order number such as EVR-2610-004") }),
    run: async ({ orderNo }) => {
      const { orders } = await computeCosting();
      const o = orders.find((x) => x.orderNo.toUpperCase() === orderNo.toUpperCase());
      if (!o) return { found: false, orderNo, knownOrderNos: orders.map((x) => x.orderNo) };
      return { found: true, ...o };
    },
  }),
  tool({
    name: "monthSummary",
    description:
      "Month-end accounts summary: net profit, revenue, cost of orders, unabsorbed overhead, payments received, GST invoiced, expenses by category, wages accrued from attendance, receivables outstanding.",
    args: z.object({ month }),
    run: async ({ month: m }) => monthSummary(m ?? currentMonthKey()),
  }),
  tool({
    name: "machineOutput",
    description: "Production output per machine (metres) for today and the last N days, with shifts logged and utilisation.",
    args: z.object({ days: z.number().int().min(1).max(90).optional().describe("Look-back window in days, default 7") }),
    run: async ({ days }) => {
      const out = await machineOutput(days ?? 7);
      return { ...out, machines: out.machines.map(({ daily, ...m }) => (void daily, m)) };
    },
  }),
  tool({
    name: "machineRejectRate",
    description:
      "Roll QC results per machine over the last N days: inspected, pass, rework, reject, reject rate and share of all rejects. Optional machineName filter (e.g. 'Loom 4').",
    args: z.object({
      machineName: z.string().trim().min(1).optional(),
      days: z.number().int().min(1).max(365).optional().describe("Look-back window in days, default 30"),
    }),
    run: async ({ machineName, days }) => {
      const q = await machineQuality(days ?? 30);
      if (!machineName) return q;
      const needle = machineName.toLowerCase();
      return { ...q, filter: machineName, machines: q.machines.filter((m) => m.name.toLowerCase().includes(needle)) };
    },
  }),
  tool({
    name: "defectsByType",
    description: "Count of QC defects by type (hole, colour mismatch, uneven weave) over the last N days.",
    args: z.object({ days: z.number().int().min(1).max(365).optional() }),
    run: async ({ days }) => {
      const d = days ?? 30;
      const records = await db.qCRecord.findMany({
        where: { inspectedAt: { gte: new Date(Date.now() - d * 86_400_000) }, ...notReversed },
        select: { result: true, defects: true },
      });
      const counts: Record<string, number> = {};
      let unreadable = 0;
      for (const r of records) {
        try {
          for (const defect of JSON.parse(r.defects) as string[]) counts[defect] = (counts[defect] ?? 0) + 1;
        } catch {
          unreadable++;
        }
      }
      return { days: d, inspections: records.length, defects: counts, unreadableRecords: unreadable };
    },
  }),
  tool({
    name: "yarnStock",
    description: "Yarn stock per stocked (not archived) yarn type: kg remaining vs low-stock threshold, and which types are low.",
    args: z.object({ onlyLow: z.boolean().optional() }),
    run: async ({ onlyLow }) => {
      const types = await db.yarnType.findMany({ where: { archivedAt: null }, include: { lots: { select: { qtyRemainingKg: true } } } });
      const rows = types.map((t) => {
        const remainingKg = r2(t.lots.reduce((s, l) => s + l.qtyRemainingKg, 0));
        return {
          yarn: `${t.name} (${t.colour})`,
          remainingKg,
          thresholdKg: t.lowStockThresholdKg,
          costPerKg: t.costPerKg,
          low: remainingKg <= t.lowStockThresholdKg,
        };
      });
      return { yarnTypes: onlyLow ? rows.filter((r) => r.low) : rows };
    },
  }),
  tool({
    name: "outstandingPayments",
    description: "Invoices not fully paid: invoice, order, buyer, total, paid and outstanding, plus total receivables and per-buyer totals.",
    args: z.object({}),
    run: async () => {
      const invoices = await db.invoice.findMany({
        where: notReversed,
        include: { payments: { where: notReversed, select: { amount: true } }, order: { select: { orderNo: true, buyer: { select: { name: true } } } } },
        orderBy: { invoiceNo: "asc" },
      });
      const open = invoices
        .map((i) => {
          const paid = r2(i.payments.reduce((s, p) => s + p.amount, 0));
          return {
            invoiceNo: i.invoiceNo,
            orderNo: i.order.orderNo,
            buyer: i.order.buyer.name,
            total: i.total,
            paid,
            outstanding: r2(i.total - paid),
          };
        })
        .filter((i) => i.outstanding > 0.005);
      const byBuyer: Record<string, number> = {};
      for (const i of open) byBuyer[i.buyer] = r2((byBuyer[i.buyer] ?? 0) + i.outstanding);
      return {
        invoicesTotal: invoices.length,
        openInvoices: open,
        totalOutstanding: r2(open.reduce((s, i) => s + i.outstanding, 0)),
        byBuyer,
      };
    },
  }),
  tool({
    name: "attendanceSummary",
    description: "Attendance and wages for a month: per worker present/half/absent days and wages earned, totals, and most-absent workers.",
    args: z.object({ month }),
    run: async ({ month: m }) => {
      const mm = m ?? currentMonthKey();
      const { start, end } = monthRange(mm);
      const workers = await db.worker.findMany({
        include: { attendance: { where: { date: { gte: start, lt: end } }, select: { status: true, dailyWage: true } } },
        orderBy: { name: "asc" },
      });
      const rows = workers.map((w) => {
        const n = (s: string) => w.attendance.filter((a) => a.status === s).length;
        return {
          worker: w.name,
          role: w.role,
          dailyWage: w.dailyWage,
          present: n("present"),
          halfDay: n("half_day"),
          absent: n("absent"),
          wages: r2(w.attendance.reduce((s, a) => s + (a.dailyWage ?? w.dailyWage) * (WAGE_FACTOR[a.status as AttendanceStatus] ?? 0), 0)),
        };
      });
      return {
        month: mm,
        monthLabel: monthLabel(mm),
        workers: rows,
        totalWages: r2(rows.reduce((s, r) => s + r.wages, 0)),
        mostAbsent: [...rows].sort((a, b) => b.absent - a.absent).filter((r) => r.absent > 0).slice(0, 3),
      };
    },
  }),
  tool({
    name: "ordersOverview",
    description:
      "List of orders with status, production/QC/dispatch/payment status, buyer, quantity, price per metre and deadline. Optional filters: status (NEW, CONFIRMED, IN_PRODUCTION, QC, READY, DISPATCHED, CLOSED), dispatchStatus (NOT_DISPATCHED, PARTIALLY_DISPATCHED, FULLY_DISPATCHED), paymentStatus (UNPAID, PARTIAL, PAID).",
    args: z.object({
      status: z.enum(["NEW", "CONFIRMED", "IN_PRODUCTION", "QC", "READY", "DISPATCHED", "CLOSED"]).optional(),
      dispatchStatus: z.enum(["NOT_DISPATCHED", "PARTIALLY_DISPATCHED", "FULLY_DISPATCHED"]).optional(),
      paymentStatus: z.enum(["UNPAID", "PARTIAL", "PAID"]).optional(),
    }),
    run: async ({ status, dispatchStatus, paymentStatus }) => {
      const orders = await db.order.findMany({
        where: {
          ...(status ? { status } : {}),
          ...(dispatchStatus ? { dispatchStatus } : {}),
          ...(paymentStatus ? { paymentStatus } : {}),
        },
        include: { buyer: { select: { name: true } } },
        orderBy: { deadline: "asc" },
      });
      return {
        count: orders.length,
        orders: orders.map((o) => ({
          orderNo: o.orderNo,
          buyer: o.buyer.name,
          status: o.status,
          productionStatus: o.productionStatus,
          qcStatus: o.qcStatus,
          dispatchStatus: o.dispatchStatus,
          paymentStatus: o.paymentStatus,
          fabric: `${o.fabricType} ${o.colour} ${o.gsm} GSM`,
          qtyMetres: o.qtyMetres,
          pricePerMetre: o.pricePerMetre,
          deadline: o.deadline.toISOString().slice(0, 10),
        })),
      };
    },
  }),
  tool({
    name: "recentAlerts",
    description: "Unread alerts (low stock, breakdowns, delay risk, orders ready, payments) newest first.",
    args: z.object({ limit: z.number().int().min(1).max(50).optional() }),
    run: async ({ limit }) => {
      // Raise/clear the derived alerts first so the answer matches the bell.
      await syncDerivedAlerts();
      const [alerts, unread] = await Promise.all([
        db.notification.findMany({
          where: { read: false },
          orderBy: { createdAt: "desc" },
          take: limit ?? 10,
          select: { type: true, message: true, severity: true, createdAt: true },
        }),
        db.notification.count({ where: { read: false } }),
      ]);
      return { unread, shown: alerts.length, alerts: alerts.map((a) => ({ ...a, type: a.type.split(":")[0] })) };
    },
  }),
] as const;

export type ToolName = (typeof TOOLS)[number]["name"];

export function findTool(name: string): AssistantTool | undefined {
  return (TOOLS as readonly AssistantTool[]).find((t) => t.name === name);
}

/** Tool list as the model sees it: name, description and argument JSON schema. */
export function toolCatalog(): string {
  return TOOLS.map((t) => {
    const schema = z.toJSONSchema(t.args, { unrepresentable: "any" }) as { properties?: object };
    return `- ${t.name}: ${t.description}\n  args: ${JSON.stringify(schema.properties ?? {})}`;
  }).join("\n");
}
