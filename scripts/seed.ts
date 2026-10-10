import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { seedProduction } from "./seed-production";
import { seedQuality } from "./seed-quality";
import { seedAccounts } from "./seed-accounts";
import {
  recomputeProductionStatus,
  recomputeQcStatus,
  recomputeDispatchStatus,
  recomputePaymentStatus,
} from "../src/lib/order-status";
import { backfillLedgerEntries } from "../src/lib/ledger";

const db = new PrismaClient();

async function main() {
  // ---------------------------------------------------------------------
  // Module 1 (Chezhil) — users, suppliers, buyers, yarn types/lots, orders.
  // Other modules: append your own section below, in your own clearly
  // commented block. Never delete another module's block.
  // ---------------------------------------------------------------------

  console.log("Seeding users...");
  const users: { name: string; role: string; password: string }[] = [
    { name: "owner", role: "owner", password: "owner123" },
    { name: "storekeeper", role: "storekeeper", password: "store123" },
    { name: "floor", role: "floor_supervisor", password: "floor123" },
    { name: "qc", role: "qc_inspector", password: "qc123" },
  ];
  for (const u of users) {
    const existing = await db.user.findFirst({ where: { name: u.name } });
    if (existing) continue;
    await db.user.create({
      data: { name: u.name, role: u.role, passwordHash: await bcrypt.hash(u.password, 10) },
    });
  }

  console.log("Seeding suppliers...");
  const supplierNames = [
    { name: "Shree Yarns Pvt Ltd", contact: "+91 98765 11111", gstin: "27AASFS1234A1Z5" },
    { name: "Om Spinning Mills", contact: "+91 98765 22222", gstin: "27AASFS5678B1Z2" },
    { name: "Nandan Textrade", contact: "+91 98765 33333", gstin: "27AASFS9012C1Z8" },
    { name: "Vardhman Cotspin", contact: "+91 98765 44444", gstin: null },
  ];
  const suppliers = [];
  for (const s of supplierNames) {
    suppliers.push(await db.supplier.create({ data: s }));
  }

  console.log("Seeding buyers...");
  const buyerNames = [
    { name: "Rajesh Garments", contact: "+91 90000 11111", address: "Tirupur, TN" },
    { name: "Maya Textiles", contact: "+91 90000 22222", address: "Surat, GJ" },
    { name: "Global Export House", contact: "+91 90000 33333", address: "Mumbai, MH" },
    { name: "Shah Fabrics", contact: "+91 90000 44444", address: "Ahmedabad, GJ" },
    { name: "Coastal Apparel Co", contact: "+91 90000 55555", address: "Tiruppur, TN" },
  ];
  const buyers = [];
  for (const b of buyerNames) {
    buyers.push(await db.buyer.create({ data: b }));
  }

  console.log("Seeding yarn types and lots...");
  const yarnTypeDefs = [
    { name: "Cotton 30s", count: "30s", material: "Cotton", colour: "Natural", lowStockThresholdKg: 200, costPerKg: 280 },
    { name: "Cotton 40s", count: "40s", material: "Cotton", colour: "White", lowStockThresholdKg: 150, costPerKg: 310 },
    { name: "Polyester 20s", count: "20s", material: "Polyester", colour: "Black", lowStockThresholdKg: 180, costPerKg: 190 },
    { name: "Viscose 24s", count: "24s", material: "Viscose", colour: "Navy", lowStockThresholdKg: 120, costPerKg: 240 },
    { name: "Cotton 60s", count: "60s", material: "Cotton", colour: "Grey Melange", lowStockThresholdKg: 100, costPerKg: 350 },
    { name: "Poly-Cotton 30s", count: "30s", material: "Poly-Cotton", colour: "Maroon", lowStockThresholdKg: 150, costPerKg: 260 },
  ];
  const yarnTypes = [];
  for (const yt of yarnTypeDefs) {
    yarnTypes.push(await db.yarnType.create({ data: yt }));
  }

  // One yarn type (Cotton 60s) deliberately near its low-stock threshold.
  const lotDefs = [
    { yarnType: yarnTypes[0], supplier: suppliers[0], lotNo: "LOT-A101", qty: 850 },
    { yarnType: yarnTypes[1], supplier: suppliers[1], lotNo: "LOT-B202", qty: 620 },
    { yarnType: yarnTypes[2], supplier: suppliers[2], lotNo: "LOT-C303", qty: 900 },
    { yarnType: yarnTypes[3], supplier: suppliers[3], lotNo: "LOT-D404", qty: 450 },
    { yarnType: yarnTypes[4], supplier: suppliers[0], lotNo: "LOT-E505", qty: 110 }, // near threshold of 100
    { yarnType: yarnTypes[5], supplier: suppliers[1], lotNo: "LOT-F606", qty: 500 },
  ];
  for (const lot of lotDefs) {
    await db.yarnLot.create({
      data: {
        yarnTypeId: lot.yarnType.id,
        supplierId: lot.supplier.id,
        lotNo: lot.lotNo,
        qtyReceivedKg: lot.qty,
        qtyRemainingKg: lot.qty,
        receivedAt: new Date(),
      },
    });
  }

  console.log("Seeding orders...");
  const statuses = [
    "NEW",
    "CONFIRMED",
    "IN_PRODUCTION",
    "IN_PRODUCTION",
    "QC",
    "READY",
    "DISPATCHED",
    "CLOSED",
    "CLOSED",
    "NEW",
  ];
  const today = Date.now();
  const day = 24 * 60 * 60 * 1000;

  for (let i = 0; i < 10; i++) {
    const buyer = buyers[i % buyers.length];
    const isDelayRisk = i === 2; // one order visibly at delay risk
    const isInfeasible = i === 9; // one order flagged infeasible at creation

    const deadline = new Date(
      today + (isDelayRisk ? 2 * day : isInfeasible ? 3 * day : (10 + i) * day),
    );

    await db.order.create({
      data: {
        orderNo: `EVR-2610-${String(i + 1).padStart(3, "0")}`,
        buyerId: buyer.id,
        fabricType: ["Poplin", "Twill", "Denim", "Dobby"][i % 4],
        colour: ["White", "Navy", "Black", "Maroon"][i % 4],
        gsm: 120 + i * 10,
        qtyMetres: 500 + i * 150,
        pricePerMetre: 95 + i * 5,
        deadline,
        status: statuses[i],
        trackingToken: randomUUID().replace(/-/g, ""),
        feasibilityResult: isInfeasible
          ? "DEADLINE NOT REALISTIC: not enough machine capacity before the deadline."
          : isDelayRisk
            ? "FEASIBLE but tight: deadline is close relative to remaining work."
            : "FEASIBLE",
      },
    });
  }

  // ---------------------------------------------------------------------
  // Module 2 (Naman) — machines, work orders and production logs.
  // Implementation in scripts/seed-production.ts.
  // ---------------------------------------------------------------------
  console.log("Seeding production...");
  await seedProduction(db);

  // ---------------------------------------------------------------------
  // Module 3 (Aditya) — rolls, QC records, dispatches and their invoices.
  // Implementation in scripts/seed-quality.ts.
  // ---------------------------------------------------------------------
  await seedQuality(db);

  // ---------------------------------------------------------------------
  // Module 4 (Devacharan) — workers, a month of attendance, expenses and
  // payments. Implementation in scripts/seed-accounts.ts; runs last because
  // it reads the orders, machines, lots and invoices seeded above.
  // ---------------------------------------------------------------------
  await seedAccounts(db);

  // ---------------------------------------------------------------------
  // All four modules write Order fields directly via Prisma (not through
  // the API), so the granular status fields added for the status-split
  // feature (productionStatus/qcStatus/dispatchStatus/paymentStatus) never
  // got touched above — they're still sitting at their schema defaults
  // regardless of how far along each seeded order actually is. Recompute
  // them for real from the Roll/Invoice/Payment rows just seeded, using the
  // exact same logic the app uses on every write (src/lib/order-status.ts),
  // so demo data is internally consistent.
  // Module 4's seed also writes Invoice/Payment rows directly via Prisma, so
  // they never go through the ledger-posting write paths either (item 3).
  // Backfill their LedgerEntry rows first — recomputePaymentStatus below
  // reads the ledger, not Payment rows directly, so it would otherwise see
  // every seeded order as UNPAID.
  console.log("Backfilling ledger entries for seeded invoices/payments/expenses...");
  const backfilled = await backfillLedgerEntries(db);
  console.log(`  ${backfilled.invoices} invoice(s), ${backfilled.payments} payment(s), ${backfilled.expenses} expense(s).`);

  console.log("Recomputing order status fields from seeded production/QC/dispatch/payment data...");
  const allOrderIds = (await db.order.findMany({ select: { id: true } })).map((o) => o.id);
  for (const orderId of allOrderIds) {
    await db.$transaction(async (tx) => {
      await recomputeProductionStatus(tx, orderId);
      await recomputeQcStatus(tx, orderId);
      await recomputeDispatchStatus(tx, orderId);
      await recomputePaymentStatus(tx, orderId);
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
