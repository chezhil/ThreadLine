import type { PrismaClient } from "@prisma/client";
import { computeInvoiceTotals } from "../src/lib/billing";

// ---------------------------------------------------------------------------
// Module 4 (Devacharan) — Accounts/HR seed: workers, a month of attendance,
// expenses and buyer payments, consistent with whatever orders, machines,
// yarn lots and invoices the other modules have already seeded.
//
// Idempotent: re-running adds nothing that's already there.
//
// One cross-module write, flagged in AI_NOTES.md: if a DISPATCHED/CLOSED order
// has no invoice (Module 1's seed creates none), this creates one with Module
// 1's own GST helper and numbering pattern, so payments have something to be
// recorded against. It never touches an order that already has an invoice.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Deterministic PRNG so every seed run produces the same demo month.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** IST midnight of the day `daysAgo` days before today. */
function istDay(daysAgo: number, now = new Date()): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const midnightUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  return new Date(midnightUtc - IST_OFFSET_MS - daysAgo * DAY_MS);
}

const isSunday = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS).getUTCDay() === 0;
const round2 = (n: number) => Math.round(n * 100) / 100;

const WORKERS = [
  { name: "Murugesan K", role: "spinner", dailyWage: 720, shift: "Morning (Shift A)" },
  { name: "Senthil Kumar", role: "weaver", dailyWage: 850, shift: "Morning (Shift A)" },
  { name: "Arumugam P", role: "weaver", dailyWage: 820, shift: "Morning (Shift A)" },
  { name: "Kavitha R", role: "weaver", dailyWage: 820, shift: "Evening (Shift B)" },
  { name: "Ravi Shankar", role: "weaver", dailyWage: 800, shift: "Evening (Shift B)" },
  { name: "Selvi M", role: "weaver", dailyWage: 780, shift: "Night (Shift C)" },
  { name: "Prakash Yadav", role: "dyer", dailyWage: 900, shift: "Morning (Shift A)" },
  { name: "Ganesan S", role: "fitter", dailyWage: 950, shift: "Morning (Shift A)" },
  { name: "Meena Kumari", role: "qc_checker", dailyWage: 760, shift: "Morning (Shift A)" },
  { name: "Vinod Patil", role: "supervisor", dailyWage: 1100, shift: "Morning (Shift A)" },
];

const MACHINE_TYPE_FOR_ROLE: Record<string, string> = { spinner: "spinning", weaver: "loom", dyer: "dyeing" };

export async function seedAccounts(db: PrismaClient, now = new Date()) {
  const rand = mulberry32(2610);
  console.log("Seeding Module 4: workers, attendance, expenses, invoices for dispatched orders, payments...");

  // --- Workers --------------------------------------------------------------
  const workers = [];
  for (const w of WORKERS) {
    const existing = await db.worker.findFirst({ where: { name: w.name } });
    workers.push(
      existing ??
        (await db.worker.create({ data: { name: w.name, role: w.role, dailyWage: w.dailyWage } })),
    );
  }

  // --- Attendance: last 30 days, Sundays off ---------------------------------
  const machines = await db.machine.findMany({ orderBy: { name: "asc" } });
  const machinesOfType = (type: string) => machines.filter((m) => m.type === type);
  const roleIndex: Record<string, number> = {};
  let marks = 0;
  for (const [i, w] of WORKERS.entries()) {
    const worker = workers[i];
    const type = MACHINE_TYPE_FOR_ROLE[w.role];
    const pool = type ? machinesOfType(type) : [];
    const idx = (roleIndex[w.role] = (roleIndex[w.role] ?? -1) + 1);
    // Operators stay on "their" machine; a breakdown machine's operator is idle (no machine).
    const home = pool.length ? pool[idx % pool.length] : null;
    for (let daysAgo = 30; daysAgo >= 0; daysAgo--) {
      const date = istDay(daysAgo, now);
      if (isSunday(date)) continue;
      const exists = await db.attendance.findFirst({ where: { workerId: worker.id, date, shift: w.shift } });
      const r = rand();
      if (exists) continue;
      const status = r < 0.06 ? "absent" : r < 0.12 ? "half_day" : "present";
      const machineId = status !== "absent" && home && home.status !== "BREAKDOWN" ? home.id : null;
      await db.attendance.create({ data: { workerId: worker.id, date, shift: w.shift, status, machineId } });
      marks++;
    }
  }

  // --- Expenses ---------------------------------------------------------------
  async function expense(category: string, amount: number, date: Date, note: string, orderId: string | null = null) {
    if (await db.expense.findFirst({ where: { note } })) return false;
    await db.expense.create({ data: { category, amount: round2(amount), date, note, orderId } });
    return true;
  }
  let expenses = 0;

  // Amounts are sized to the seeded mill's output (a few thousand metres a
  // month across four looms), so the demo P&L shows a plausible margin.
  // Power: weekly TNEB/BESCOM meter readings + a monthly DG diesel top-up.
  for (const daysAgo of [28, 21, 14, 7]) {
    const d = istDay(daysAgo, now);
    if (await expense("power", 11000 + Math.round(rand() * 2500), d, `Electricity bill — week ending ${d.toISOString().slice(0, 10)}`)) expenses++;
  }
  if (await expense("other", 6500, istDay(16, now), "DG set diesel top-up (70 L)")) expenses++;

  // Overhead: rent, maintenance contract, insurance, admin.
  const overheads: [number, number, string][] = [
    [27, 30000, "Factory shed rent — monthly"],
    [20, 8000, "Loom AMC — service visit"],
    [12, 5200, "Fire & machinery insurance — monthly premium"],
    [5, 3400, "Office, phone and internet"],
  ];
  for (const [daysAgo, amt, note] of overheads) if (await expense("overhead", amt, istDay(daysAgo, now), note)) expenses++;

  // Yarn purchase bills matching lots received in the last 45 days (qty × rate).
  const lots = await db.yarnLot.findMany({
    where: { receivedAt: { gte: new Date(now.getTime() - 45 * DAY_MS) } },
    include: { yarnType: true, supplier: true },
  });
  for (const lot of lots) {
    const note = `Yarn bill ${lot.lotNo} — ${lot.supplier.name}, ${lot.qtyReceivedKg} kg ${lot.yarnType.name} @ ₹${lot.yarnType.costPerKg}/kg`;
    if (await expense("yarn", lot.qtyReceivedKg * lot.yarnType.costPerKg, lot.receivedAt, note)) expenses++;
  }

  // Wages actually paid out: weekly payroll = wages earned per attendance that week.
  for (const weekEndAgo of [24, 17, 10, 3]) {
    const end = istDay(weekEndAgo, now);
    const start = new Date(end.getTime() - 6 * DAY_MS);
    const week = await db.attendance.findMany({
      where: { date: { gte: start, lte: end } },
      include: { worker: { select: { dailyWage: true } } },
    });
    const total = week.reduce((s, a) => s + a.worker.dailyWage * (a.status === "present" ? 1 : a.status === "half_day" ? 0.5 : 0), 0);
    if (total > 0 && (await expense("wages", total, end, `Weekly payroll paid — week ending ${end.toISOString().slice(0, 10)}`))) expenses++;
  }

  // Order-specific bills: dyes & chemicals for orders that reached dyeing or later.
  const dyedOrders = await db.order.findMany({
    where: { status: { in: ["IN_PRODUCTION", "QC", "READY", "DISPATCHED", "CLOSED"] } },
    orderBy: { orderNo: "asc" },
  });
  for (const [i, o] of dyedOrders.entries()) {
    const perMetre = 6 + (i % 4) * 2.5;
    if (await expense("other", o.qtyMetres * perMetre, istDay(Math.max(1, 18 - i * 3), now), `Dyes & chemicals for ${o.orderNo} (₹${perMetre}/m)`, o.id)) expenses++;
  }

  // --- Invoices for delivered orders that have none (see header note) ------------
  const delivered = await db.order.findMany({
    where: { status: { in: ["DISPATCHED", "CLOSED"] }, invoices: { none: {} } },
    orderBy: { orderNo: "asc" },
  });
  let invoicesCreated = 0;
  for (const [i, o] of delivered.entries()) {
    const createdAt = istDay(o.status === "CLOSED" ? Math.max(3, 8 - i) : 2, now);
    const yymm = new Date(createdAt.getTime() + IST_OFFSET_MS).toISOString().slice(2, 7).replace("-", "");
    let count = await db.invoice.count();
    while (await db.invoice.findUnique({ where: { invoiceNo: `INV-${yymm}-${String(count + 1).padStart(4, "0")}` } })) count++;
    const subtotal = o.qtyMetres * o.pricePerMetre;
    const { gst, total } = computeInvoiceTotals(subtotal);
    await db.invoice.create({
      data: {
        invoiceNo: `INV-${yymm}-${String(count + 1).padStart(4, "0")}`,
        orderId: o.id,
        buyerId: o.buyerId,
        subtotal,
        gst,
        total,
        status: "ISSUED",
        createdAt: new Date(createdAt.getTime() + 11 * 60 * 60 * 1000),
      },
    });
    invoicesCreated++;
  }

  // --- Payments ---------------------------------------------------------------
  const invoices = await db.invoice.findMany({
    include: { payments: true, order: { select: { status: true } } },
    orderBy: { invoiceNo: "asc" },
  });
  let payments = 0;
  for (const [i, inv] of invoices.entries()) {
    if (inv.payments.length) continue;
    const invDay = Math.max(0, Math.floor((now.getTime() - inv.createdAt.getTime()) / DAY_MS));
    const at = (daysAfterInvoice: number) =>
      new Date(Math.min(now.getTime(), inv.createdAt.getTime() + daysAfterInvoice * DAY_MS + 2 * 60 * 60 * 1000));
    if (inv.order.status === "CLOSED" || inv.status === "PAID") {
      // Closed (or already marked PAID by the module that issued it) = settled:
      // half by NEFT, the rest by RTGS.
      const first = round2(inv.total / 2);
      await db.payment.create({ data: { invoiceId: inv.id, amount: first, mode: "neft", receivedAt: at(Math.min(1, invDay)) } });
      await db.payment.create({ data: { invoiceId: inv.id, amount: round2(inv.total - first), mode: "rtgs", receivedAt: at(Math.min(4, invDay)) } });
      payments += 2;
    } else if (i % 2 === 0) {
      // Every other open invoice has an advance in; the rest are fully outstanding.
      await db.payment.create({ data: { invoiceId: inv.id, amount: round2(inv.total * 0.4), mode: i % 4 === 0 ? "upi" : "neft", receivedAt: at(Math.min(1, invDay)) } });
      payments++;
    }
  }

  console.log(
    `  Module 4: ${workers.length} workers, ${marks} new attendance marks, ${expenses} new expenses, ${invoicesCreated} invoices for uninvoiced delivered orders, ${payments} new payments.`,
  );
}
