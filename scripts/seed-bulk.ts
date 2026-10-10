// Generates a large, scale-test dataset on top of the curated demo seed
// (scripts/seed.ts) — so we can answer "will the dashboard/DB handle ~500
// orders" with a real measurement instead of a guess. Separate orderNo/
// invoiceNo/rollNo prefix ("BLK-" / order no "EVR-BLK-") so it never collides
// with or touches the curated 10-order narrative seed.
//
// Usage: npx tsx scripts/seed-bulk.ts            (defaults to 500 orders)
//        BULK_ORDERS=1000 npx tsx scripts/seed-bulk.ts
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { computeInvoiceTotals } from "../src/lib/billing";
import { backfillLedgerEntries } from "../src/lib/ledger";
import {
  recomputeProductionStatus,
  recomputeQcStatus,
  recomputeDispatchStatus,
  recomputePaymentStatus,
} from "../src/lib/order-status";

const db = new PrismaClient();

const ORDER_COUNT = Number(process.env.BULK_ORDERS ?? 500);
const CHUNK = 500;
const DAY = 24 * 60 * 60 * 1000;

async function chunked<T>(label: string, rows: T[], fn: (batch: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await fn(rows.slice(i, i + CHUNK));
  }
  console.log(`  ${label}: ${rows.length}`);
}

type Bucket = "NEW" | "CONFIRMED" | "IN_PRODUCTION" | "QC" | "READY" | "DISPATCHED" | "CLOSED";

// Cumulative-weight bucket distribution, picked deterministically from i so
// re-running with a larger BULK_ORDERS is still reproducible.
const BUCKETS: { key: Bucket; weight: number }[] = [
  { key: "NEW", weight: 0.08 },
  { key: "CONFIRMED", weight: 0.12 },
  { key: "IN_PRODUCTION", weight: 0.18 },
  { key: "QC", weight: 0.14 },
  { key: "READY", weight: 0.13 },
  { key: "DISPATCHED", weight: 0.2 },
  { key: "CLOSED", weight: 0.15 },
];
function pickBucket(i: number): Bucket {
  const r = i / ORDER_COUNT;
  let acc = 0;
  for (const b of BUCKETS) {
    acc += b.weight;
    if (r < acc) return b.key;
  }
  return "CLOSED";
}

async function main() {
  const [buyers, yarnLots, machines, users] = await Promise.all([
    db.buyer.findMany({ where: { archivedAt: null } }),
    db.yarnLot.findMany(),
    db.machine.findMany(),
    db.user.findMany(),
  ]);
  if (!buyers.length || !yarnLots.length || !machines.length) {
    throw new Error("Run `npm run seed` first — bulk seed reuses buyers/yarn lots/machines from it.");
  }
  const spinning = machines.filter((m) => m.type === "spinning");
  const looms = machines.filter((m) => m.type === "loom");
  const dyeing = machines.filter((m) => m.type === "dyeing");
  const floorUser = users.find((u) => u.role === "floor_supervisor") ?? users[0];
  const qcUser = users.find((u) => u.role === "qc_inspector") ?? users[0];

  const fabricTypes = ["Poplin", "Twill", "Denim", "Dobby", "Canvas", "Satin", "Chambray"];
  const colours = ["White", "Navy", "Black", "Maroon", "Olive", "Grey", "Indigo"];
  const now = Date.now();

  const orders: Prisma.OrderCreateManyInput[] = [];
  const workOrders: Prisma.WorkOrderCreateManyInput[] = [];
  const productionLogs: Prisma.ProductionLogCreateManyInput[] = [];
  const rolls: Prisma.RollCreateManyInput[] = [];
  const qcRecords: Prisma.QCRecordCreateManyInput[] = [];
  const dispatches: Prisma.DispatchCreateManyInput[] = [];
  const invoices: Prisma.InvoiceCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];

  const existingOrderCount = await db.order.count();
  let invoiceSeq = (await db.invoice.count()) + 1;

  for (let i = 0; i < ORDER_COUNT; i++) {
    const orderId = randomUUID();
    const buyer = buyers[i % buyers.length];
    const bucket = pickBucket(i);
    const daysAgo = 1 + (i % 150); // spread across ~5 months for month-grouped analytics
    const createdAt = new Date(now - daysAgo * DAY);
    const qtyMetres = 300 + (i % 20) * 50;
    const pricePerMetre = 90 + (i % 15) * 4;
    const orderNo = `EVR-BLK-${String(existingOrderCount + i + 1).padStart(5, "0")}`;

    const hasWorkOrders = bucket !== "NEW" && bucket !== "CONFIRMED";
    const productionDone = hasWorkOrders && bucket !== "IN_PRODUCTION";
    const rawStatus: string = bucket === "NEW" ? "NEW" : bucket === "CONFIRMED" || bucket === "IN_PRODUCTION" ? "CONFIRMED" : bucket;

    orders.push({
      id: orderId,
      orderNo,
      buyerId: buyer.id,
      fabricType: fabricTypes[i % fabricTypes.length],
      colour: colours[i % colours.length],
      gsm: 110 + (i % 8) * 10,
      qtyMetres,
      pricePerMetre,
      deadline: new Date(createdAt.getTime() + (10 + (i % 20)) * DAY),
      status: rawStatus,
      trackingToken: randomUUID().replace(/-/g, ""),
      feasibilityResult: "FEASIBLE",
      createdAt,
    });

    if (!hasWorkOrders) continue;

    // spinning -> weaving -> dyeing. For IN_PRODUCTION, weaving is still
    // running and dyeing hasn't started; otherwise all three are COMPLETED.
    const stagePlan: { stage: string; machine: (typeof machines)[number] }[] = [
      { stage: "spinning", machine: spinning[i % spinning.length] },
      { stage: "weaving", machine: looms[i % looms.length] },
      { stage: "dyeing", machine: dyeing[i % dyeing.length] },
    ];
    const finishedAt = new Date(createdAt.getTime() + 2 * DAY);
    for (const [stageIdx, { stage, machine }] of stagePlan.entries()) {
      const isRunning = bucket === "IN_PRODUCTION" && stageIdx === 1;
      const skip = bucket === "IN_PRODUCTION" && stageIdx === 2;
      if (skip) continue;
      const workOrderId = randomUUID();
      const plannedQty = qtyMetres;
      const producedQty = isRunning ? Math.round(qtyMetres * 0.4) : qtyMetres;
      workOrders.push({
        id: workOrderId,
        orderId,
        stage,
        machineId: machine.id,
        plannedQty,
        producedQty,
        status: isRunning ? "IN_PROGRESS" : "COMPLETED",
        startedAt: new Date(createdAt.getTime() + DAY),
        finishedAt: isRunning ? null : finishedAt,
      });
      if (producedQty > 0 && floorUser) {
        productionLogs.push({
          id: randomUUID(),
          workOrderId,
          machineId: machine.id,
          shift: stageIdx % 2 === 0 ? "Morning" : "Evening",
          qtyProduced: producedQty,
          loggedAt: isRunning ? new Date() : finishedAt,
          loggedBy: floorUser.id,
        });
      }
      // Rolls are minted off the final (dyeing) completed work order.
      if (!skip && stage === "dyeing" && productionDone) {
        const rollCount = 3 + (i % 4);
        const dispatchId = bucket === "DISPATCHED" || bucket === "CLOSED" ? randomUUID() : null;
        if (dispatchId) {
          dispatches.push({
            id: dispatchId,
            buyerId: buyer.id,
            truckNo: `GJ05-${String(1000 + (i % 9000))}`,
            dispatchedAt: new Date(createdAt.getTime() + 4 * DAY),
          });
        }
        for (let r = 0; r < rollCount; r++) {
          const rollId = randomUUID();
          const yarnLot = yarnLots[(i + r) % yarnLots.length];
          const isReject = productionDone && bucket !== "DISPATCHED" && bucket !== "CLOSED" && r === 0 && bucket === "QC";
          let qcStatus: string;
          if (bucket === "QC") qcStatus = r === 0 ? "PENDING" : r % 2 === 0 ? "PASS" : "REWORK";
          else if (isReject) qcStatus = "REJECT";
          else qcStatus = "PASS";
          const lengthMetres = Math.round(qtyMetres / rollCount);
          rolls.push({
            id: rollId,
            rollNo: `BLK-R-${String(existingOrderCount + i + 1).padStart(5, "0")}-${r + 1}`,
            orderId,
            workOrderId,
            machineId: machine.id,
            shift: r % 2 === 0 ? "Morning" : "Evening",
            yarnLotId: yarnLot.id,
            lengthMetres,
            weightKg: Math.round(lengthMetres * 0.18 * 100) / 100,
            qcStatus,
            dispatchId: qcStatus === "PASS" ? dispatchId : null,
            qrToken: randomUUID(),
          });
          if (qcStatus !== "PENDING" && qcUser) {
            qcRecords.push({
              id: randomUUID(),
              rollId,
              inspectorId: qcUser.id,
              result: qcStatus,
              defects: qcStatus === "PASS" ? "[]" : JSON.stringify(["uneven_weave"]),
              inspectedAt: new Date(createdAt.getTime() + 3 * DAY),
            });
          }
        }
      }
    }

    if (bucket === "DISPATCHED" || bucket === "CLOSED") {
      const subtotal = qtyMetres * pricePerMetre;
      const { gst, total } = computeInvoiceTotals(subtotal);
      const invoiceId = randomUUID();
      const invoiceCreatedAt = new Date(createdAt.getTime() + 5 * DAY);
      const yymm = `${String(invoiceCreatedAt.getFullYear()).slice(2)}${String(invoiceCreatedAt.getMonth() + 1).padStart(2, "0")}`;
      invoices.push({
        id: invoiceId,
        invoiceNo: `INV-${yymm}-${String(invoiceSeq++).padStart(4, "0")}`,
        orderId,
        buyerId: buyer.id,
        subtotal,
        gst,
        total,
        status: "ISSUED",
        createdAt: invoiceCreatedAt,
      });
      if (bucket === "CLOSED") {
        const first = Math.round((total / 2) * 100) / 100;
        payments.push(
          { id: randomUUID(), invoiceId, amount: first, mode: "neft", receivedAt: new Date(invoiceCreatedAt.getTime() + DAY) },
          { id: randomUUID(), invoiceId, amount: Math.round((total - first) * 100) / 100, mode: "rtgs", receivedAt: new Date(invoiceCreatedAt.getTime() + 4 * DAY) },
        );
      } else if (i % 2 === 0) {
        payments.push({
          id: randomUUID(),
          invoiceId,
          amount: Math.round(total * 0.4 * 100) / 100,
          mode: i % 4 === 0 ? "upi" : "neft",
          receivedAt: new Date(invoiceCreatedAt.getTime() + DAY),
        });
      }
    }
  }

  console.log(`Generating ${ORDER_COUNT} orders (bucket distribution applied)...`);
  await chunked("orders", orders, (batch) => db.order.createMany({ data: batch }));
  await chunked("workOrders", workOrders, (batch) => db.workOrder.createMany({ data: batch }));
  await chunked("productionLogs", productionLogs, (batch) => db.productionLog.createMany({ data: batch }));
  await chunked("dispatches", dispatches, (batch) => db.dispatch.createMany({ data: batch }));
  await chunked("rolls", rolls, (batch) => db.roll.createMany({ data: batch }));
  await chunked("qcRecords", qcRecords, (batch) => db.qCRecord.createMany({ data: batch }));
  await chunked("invoices", invoices, (batch) => db.invoice.createMany({ data: batch }));
  await chunked("payments", payments, (batch) => db.payment.createMany({ data: batch }));

  console.log("Backfilling ledger entries...");
  const backfilled = await backfillLedgerEntries(db);
  console.log(`  ${backfilled.invoices} invoice(s), ${backfilled.payments} payment(s), ${backfilled.expenses} expense(s).`);

  console.log("Recomputing derived order status fields...");
  const newOrderIds = orders.map((o) => o.id as string);
  let done = 0;
  for (const orderId of newOrderIds) {
    await db.$transaction(async (tx) => {
      await recomputeProductionStatus(tx, orderId);
      await recomputeQcStatus(tx, orderId);
      await recomputeDispatchStatus(tx, orderId);
      await recomputePaymentStatus(tx, orderId);
    });
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${newOrderIds.length}`);
  }
  console.log(`Bulk seed complete: ${ORDER_COUNT} orders, ${rolls.length} rolls, ${invoices.length} invoices.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
