// Hand-checked fixture test for the cost-per-order engine and month summary.
// Builds a throwaway SQLite DB, inserts a small mill whose costs are worked
// out by hand below, and compares every figure.
//
//   npx tsx scripts/verify-costing.ts

import { execSync } from "child_process";
import { closeSync, existsSync, openSync, rmSync } from "fs";
import path from "path";

const DB_FILE = path.join(__dirname, "..", "prisma", "verify-costing.db");
const DATABASE_URL = "file:./verify-costing.db";

let failures = 0;
function eq(name: string, actual: number | string | null | undefined, expected: number | string | null) {
  const ok =
    typeof expected === "number" && typeof actual === "number" ? Math.abs(actual - expected) < 0.011 : actual === expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `: expected ${expected}, got ${actual}`}`);
  if (!ok) failures++;
}

// IST wall-clock → instant
const ist = (s: string) => new Date(`${s}+05:30`);

async function main() {
  for (const f of [DB_FILE, `${DB_FILE}-journal`]) if (existsSync(f)) rmSync(f);
  // Ensure SQLite has a writable file before the Prisma schema engine opens it.
  closeSync(openSync(DB_FILE, "w"));
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL }, stdio: "ignore" });
  process.env.DATABASE_URL = DATABASE_URL;

  const { PrismaClient } = await import("@prisma/client");
  const { computeCosting, rollCostsForOrder, ordersRealisedIn } = await import("../src/lib/accounts/costing");
  const { monthSummary } = await import("../src/lib/accounts/summary");
  const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

  try {
    const buyer = await db.buyer.create({ data: { name: "Test Buyer", contact: "x" } });
    const supplier = await db.supplier.create({ data: { name: "Test Supplier", contact: "x" } });
    const yarn = await db.yarnType.create({
      data: { name: "Cotton", count: "30s", material: "Cotton", colour: "White", lowStockThresholdKg: 10, costPerKg: 300 },
    });
    const lot = await db.yarnLot.create({
      data: { yarnTypeId: yarn.id, supplierId: supplier.id, lotNo: "L1", qtyReceivedKg: 1000, qtyRemainingKg: 800, receivedAt: ist("2026-09-01T09:00:00") },
    });
    const mk = (orderNo: string, qty: number, price: number, status: string) =>
      db.order.create({
        data: { orderNo, buyerId: buyer.id, fabricType: "Poplin", colour: "White", gsm: 120, qtyMetres: qty, pricePerMetre: price, deadline: ist("2026-12-01T00:00:00"), status, trackingToken: orderNo, createdAt: ist("2026-09-01T10:00:00") },
      });
    const A = await mk("T-A", 1000, 100, "DISPATCHED"); // revenue 1,00,000
    const B = await mk("T-B", 500, 120, "IN_PRODUCTION"); // revenue 60,000
    const L1 = await db.machine.create({ data: { name: "L1", type: "loom", status: "RUNNING", capacityMetresPerShift: 500 } });
    const L2 = await db.machine.create({ data: { name: "L2", type: "loom", status: "RUNNING", capacityMetresPerShift: 500 } });
    const wo = (orderId: string, machineId: string) =>
      db.workOrder.create({ data: { orderId, stage: "weaving", machineId, plannedQty: 1000, status: "IN_PROGRESS" } });
    const woA1 = await wo(A.id, L1.id);
    const woB1 = await wo(B.id, L1.id);
    const woB2 = await wo(B.id, L2.id);
    const log = (workOrderId: string, machineId: string, shift: string, qty: number, at: string) =>
      db.productionLog.create({ data: { workOrderId, machineId, shift, qtyProduced: qty, loggedAt: ist(at), loggedBy: "u" } });
    // Sep 15: L1 Morning A300 + B100 (1 machine-shift split .75/.25), L1 Evening A200, L2 Morning B200
    await log(woA1.id, L1.id, "Morning", 300, "2026-09-15T10:00:00");
    await log(woB1.id, L1.id, "morning ", 100, "2026-09-15T11:00:00"); // same shift, different spelling/case
    await log(woA1.id, L1.id, "Evening", 200, "2026-09-15T19:00:00");
    await log(woB2.id, L2.id, "Morning", 200, "2026-09-15T23:50:00"); // late evening IST, still Sep 15
    // → Sep machine-shifts = 3; A = 0.75 + 1 = 1.75; B = 0.25 + 1 = 1.25

    const roll = (orderId: string, workOrderId: string, machineId: string, no: string, len: number, kg: number, qc: string) =>
      db.roll.create({ data: { rollNo: no, orderId, workOrderId, machineId, shift: "Morning", yarnLotId: lot.id, lengthMetres: len, weightKg: kg, qcStatus: qc, qrToken: no } });
    await roll(A.id, woA1.id, L1.id, "R-A1", 100, 50, "PASS");
    await roll(A.id, woA1.id, L1.id, "R-A2", 300, 50, "REJECT");
    await roll(B.id, woB2.id, L2.id, "R-B1", 200, 40, "PASS");
    // yarn: A 100 kg × 300 = 30,000 (+8% = 2,400); B 40 × 300 = 12,000 (+960)

    const w = (name: string, wage: number) => db.worker.create({ data: { name, role: "weaver", dailyWage: wage } });
    const [w1, w2, w3, w4, w5] = await Promise.all([w("W1", 800), w("W2", 600), w("W3", 500), w("W4", 700), w("W5", 900)]);
    const att = (workerId: string, date: string, status: string, machineId: string | null) =>
      db.attendance.create({ data: { workerId, date: ist(`${date}T00:00:00`), shift: "Morning (Shift A)", status, machineId } });
    await att(w1.id, "2026-09-15", "present", L1.id); // 800 on L1 (A500:B100) → A 666.67, B 133.33
    await att(w2.id, "2026-09-15", "half_day", L2.id); // 300 on L2 → B 300
    await att(w3.id, "2026-09-15", "present", null); // 500 indirect
    await att(w4.id, "2026-09-16", "present", L1.id); // 700, L1 idle that day → indirect
    await att(w5.id, "2026-09-15", "absent", null); // 0
    // Sep indirect pool = 1,200

    const exp = (category: string, amount: number, date: string, orderId: string | null = null) =>
      db.expense.create({ data: { category, amount, date: ist(`${date}T00:00:00`), orderId } });
    await exp("power", 3000, "2026-09-10");
    await exp("overhead", 1500, "2026-09-11");
    await exp("other", 600, "2026-09-12"); // overhead pool = 2,100
    await exp("yarn", 9999, "2026-09-12"); // stock purchase — not spread
    await exp("wages", 1111, "2026-09-30"); // payroll payout — not spread
    await exp("other", 250, "2026-09-13", A.id); // direct to A
    await exp("power", 999, "2026-10-02"); // October, no production → unabsorbed

    const inv = await db.invoice.create({
      data: { invoiceNo: "T-INV-1", orderId: A.id, buyerId: buyer.id, subtotal: 100000, gst: 5000, total: 105000, status: "ISSUED", createdAt: ist("2026-09-20T12:00:00") },
    });
    await db.payment.create({ data: { invoiceId: inv.id, amount: 50000, mode: "neft", receivedAt: ist("2026-09-25T12:00:00") } });

    const { orders, pools } = await computeCosting(db);
    const a = orders.find((o) => o.orderNo === "T-A")!;
    const b = orders.find((o) => o.orderNo === "T-B")!;

    eq("pool Sep machine-shifts", pools["2026-09"].machineShiftUnits, 3);
    eq("pool Sep power", pools["2026-09"].power, 3000);
    eq("pool Sep overhead (overhead + other, unlinked)", pools["2026-09"].overhead, 2100);
    eq("pool Sep indirect labour", pools["2026-09"].indirectLabour, 1200);
    eq("pool Sep unabsorbed", pools["2026-09"].unabsorbed, 0);
    eq("pool Oct unabsorbed (no production)", pools["2026-10"].unabsorbed, 999);

    eq("A yarn", a.costs.yarn, 30000);
    eq("A process wastage", a.costs.processWastage, 2400);
    eq("A direct wages", a.costs.directWages, 666.67);
    eq("A power", a.costs.power, 1750);
    eq("A overhead", a.costs.overhead, 1225);
    eq("A indirect labour", a.costs.indirectLabour, 700);
    eq("A direct expenses", a.costs.directExpenses, 250);
    eq("A total cost", a.totalCost, 36991.67);
    eq("A revenue", a.revenue, 100000);
    eq("A profit", a.profit, 63008.33);
    eq("A stage", a.stage, "final");
    eq("A cost per metre (÷ 400 m rolled)", a.costPerMetre, 92.48);
    eq("A rejected yarn traced", a.trace.rejectedYarnCost, 15000);
    eq("A outstanding", a.outstanding, 55000);

    eq("B yarn", b.costs.yarn, 12000);
    eq("B direct wages", b.costs.directWages, 433.33);
    eq("B power", b.costs.power, 1250);
    eq("B overhead", b.costs.overhead, 875);
    eq("B indirect labour", b.costs.indirectLabour, 500);
    eq("B total cost", b.totalCost, 16018.33);
    eq("B stage", b.stage, "in_progress");

    eq("labour fully allocated (direct + spread = earned)", a.costs.directWages + b.costs.directWages + a.costs.indirectLabour + b.costs.indirectLabour, 800 + 300 + 500 + 700);

    eq("realised in Sep", ordersRealisedIn(orders, "2026-09").map((o) => o.orderNo).join(","), "T-A");
    const sep = await monthSummary("2026-09", db);
    eq("Sep revenue", sep.pnl.revenue, 100000);
    eq("Sep cost of orders", sep.pnl.costOfOrders, 36991.67);
    eq("Sep net profit", sep.pnl.netProfit, 63008.33);
    eq("Sep WIP cost", sep.workInProgress.costToDate, 16018.33);
    eq("Sep wages earned", sep.wages.accrued, 2300);
    eq("Sep payments", sep.cash.paymentsReceived, 50000);
    eq("Sep expenses total", sep.cash.expensesTotal, 3000 + 1500 + 600 + 9999 + 1111 + 250);
    eq("receivables", sep.receivables.outstanding, 55000);
    const oct = await monthSummary("2026-10", db);
    eq("Oct net profit = −unabsorbed", oct.pnl.netProfit, -999);

    const rolls = await rollCostsForOrder(a, db);
    const r1 = rolls.find((r) => r.rollNo === "R-A1")!;
    const r2 = rolls.find((r) => r.rollNo === "R-A2")!;
    eq("roll A1 yarn (50 kg × 300 × 1.08)", r1.yarnCost, 16200);
    eq("roll A1 conversion (¼ of 4,591.67 by length)", r1.conversionCost, 1147.92);
    eq("roll A2 conversion (¾)", r2.conversionCost, 3443.75);
    eq("rolls sum to order total", r1.totalCost + r2.totalCost, a.totalCost);
  } finally {
    await db.$disconnect();
    for (const f of [DB_FILE, `${DB_FILE}-journal`]) if (existsSync(f)) rmSync(f);
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
