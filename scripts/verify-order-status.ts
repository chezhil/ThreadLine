// End-to-end checks for the order-status split: that IN_PRODUCTION/QC/READY/
// DISPATCHED are computed from real events rather than settable by hand, that
// partial dispatch is represented, and that payment status tracks real
// Payment rows. Fires real HTTP requests at a running server.
//
//   npm run dev                                            (separate terminal)
//   BASE=http://localhost:3000 npx tsx scripts/verify-order-status.ts
//
// Creates real rows (an order, machines/work-orders if needed). Run against
// a scratch/dev database.

import { db } from "../src/lib/db";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failures = 0;
let passes = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
  }
}

async function login(name: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!res.ok || !cookie) throw new Error(`login as ${name} failed (${res.status})`);
  return cookie;
}

function client(cookie: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
    return { status: res.status, json };
  };
}
function as<T>(json: unknown): T {
  return json as T;
}
interface WithId {
  id: string;
}

async function main() {
  const owner = client(await login("owner", "owner123"));
  const anyBuyer = await db.buyer.findFirstOrThrow();

  // ------------------------------------------------------------------
  // A. PATCH no longer accepts the automatic states.
  // ------------------------------------------------------------------
  console.log("\n--- A. Manual PATCH rejects the automatic states ---");
  const testOrder = as<{ order: WithId }>(
    (
      await owner("POST", "/api/orders", {
        buyerId: anyBuyer.id,
        fabricType: "Test",
        colour: "Test",
        gsm: 100,
        qtyMetres: 100,
        pricePerMetre: 100,
        deadline: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
      })
    ).json,
  ).order;

  for (const blocked of ["IN_PRODUCTION", "QC", "READY", "DISPATCHED"]) {
    const res = await owner("PATCH", `/api/orders/${testOrder.id}`, { status: blocked });
    check(`PATCH status=${blocked} is rejected (400), not applied`, res.status === 400, { status: res.status, json: res.json });
  }

  const confirmRes = await owner("PATCH", `/api/orders/${testOrder.id}`, { status: "CONFIRMED" });
  check("PATCH status=CONFIRMED from NEW succeeds", confirmRes.status === 200, confirmRes);

  const closeFromConfirmedRes = await owner("PATCH", `/api/orders/${testOrder.id}`, { status: "CLOSED" });
  check(
    "PATCH status=CLOSED from CONFIRMED (not DISPATCHED) is rejected",
    closeFromConfirmedRes.status === 400,
    closeFromConfirmedRes,
  );

  // ------------------------------------------------------------------
  // B. Production events drive productionStatus/status automatically.
  // ------------------------------------------------------------------
  console.log("\n--- B. Production events drive status automatically ---");
  const yarnType = as<{ yarnType: WithId }>(
    (
      await owner("POST", "/api/yarn-types", {
        name: "Status Test Yarn",
        count: "1s",
        material: "Test",
        colour: "Test",
        lowStockThresholdKg: 1,
        costPerKg: 1,
      })
    ).json,
  ).yarnType;
  const yarnLot = as<{ yarnLot: WithId }>(
    (
      await owner("POST", "/api/yarn-lots", {
        yarnTypeId: yarnType.id,
        supplierId: (await db.supplier.findFirstOrThrow()).id,
        lotNo: `STATUS-TEST-${Date.now()}`,
        qtyReceivedKg: 500,
        receivedAt: new Date().toISOString(),
      })
    ).json,
  ).yarnLot;
  await owner("POST", `/api/orders/${testOrder.id}/reserve-yarn`, { yarnLotId: yarnLot.id, qtyKg: 50 });

  // A dedicated, guaranteed-idle machine — reusing a seeded one risks
  // "Machine already has an active work order" depending on what else has
  // run against this DB.
  const machine = await db.machine.create({
    data: { name: `Status-Test-Spinner-${Date.now()}`, type: "spinning", status: "RUNNING", capacityMetresPerShift: 500 },
  });
  const workOrderRes = await owner("POST", "/api/work-orders", {
    orderId: testOrder.id,
    machineId: machine.id,
    stage: "spinning",
    plannedQty: 10,
  });
  check("creating a work order succeeds (yarn was reserved)", workOrderRes.status === 201, workOrderRes);
  const workOrder = as<{ id: string }>(workOrderRes.json);

  const afterWorkOrder = await db.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  check("productionStatus became IN_PRODUCTION from the real event", afterWorkOrder.productionStatus === "IN_PRODUCTION", {
    productionStatus: afterWorkOrder.productionStatus,
  });
  check("legacy status derived to IN_PRODUCTION", afterWorkOrder.status === "IN_PRODUCTION", { status: afterWorkOrder.status });

  const blockedAgain = await owner("PATCH", `/api/orders/${testOrder.id}`, { status: "IN_PRODUCTION" });
  check(
    "manually PATCHing IN_PRODUCTION is still rejected even though that IS the current state",
    blockedAgain.status === 400,
    blockedAgain,
  );

  // ------------------------------------------------------------------
  // C. Partial dispatch: dispatchStatus distinguishes partial from full.
  // Self-contained rolls (2 PASS + 1 REJECT) rather than borrowed seed
  // data, so "fully shippable" is unambiguous: REJECT must not block it.
  // ------------------------------------------------------------------
  console.log("\n--- C. Partial dispatch is represented, not just all-or-nothing ---");
  const rollFixture = (status: string, suffix: string) =>
    db.roll.create({
      data: {
        rollNo: `STATUS-TEST-${Date.now()}-${suffix}`,
        orderId: testOrder.id,
        workOrderId: workOrder.id,
        machineId: machine.id,
        shift: "Morning (Shift A)",
        yarnLotId: yarnLot.id,
        lengthMetres: 10,
        weightKg: 2,
        qcStatus: status,
        qrToken: `qr-status-test-${Date.now()}-${suffix}`,
      },
    });
  const rollA = await rollFixture("PASS", "a");
  const rollB = await rollFixture("PASS", "b");
  await rollFixture("REJECT", "c"); // must not block FULLY_DISPATCHED below

  const firstDispatch = await owner("POST", "/api/dispatches", {
    buyerId: anyBuyer.id,
    truckNo: `PARTIAL-${Date.now()}`,
    rollIds: [rollA.id],
  });
  check("first partial dispatch succeeds", firstDispatch.status === 201, firstDispatch);

  const afterPartial = await db.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  check(
    "dispatchStatus is PARTIALLY_DISPATCHED, not FULLY_DISPATCHED, after shipping only 1 of 2 shippable rolls",
    afterPartial.dispatchStatus === "PARTIALLY_DISPATCHED",
    { dispatchStatus: afterPartial.dispatchStatus },
  );
  check("legacy status does NOT jump to DISPATCHED on a partial shipment", afterPartial.status !== "DISPATCHED", {
    status: afterPartial.status,
  });

  const secondDispatch = await owner("POST", "/api/dispatches", {
    buyerId: anyBuyer.id,
    truckNo: `PARTIAL-2-${Date.now()}`,
    rollIds: [rollB.id],
  });
  check("second dispatch (remaining roll) succeeds", secondDispatch.status === 201, secondDispatch);

  const afterFull = await db.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  check(
    "dispatchStatus becomes FULLY_DISPATCHED once every PASS roll has shipped (the REJECT roll doesn't block it)",
    afterFull.dispatchStatus === "FULLY_DISPATCHED",
    { dispatchStatus: afterFull.dispatchStatus },
  );
  check("legacy status becomes DISPATCHED only now", afterFull.status === "DISPATCHED", { status: afterFull.status });

  // D. Now that it's DISPATCHED, closing it should work.
  console.log("\n--- D. Closing a fully-dispatched order ---");
  const closeRes = await owner("PATCH", `/api/orders/${testOrder.id}`, { status: "CLOSED" });
  check("PATCH status=CLOSED succeeds once DISPATCHED", closeRes.status === 200, closeRes);

  // ------------------------------------------------------------------
  // E. Payment status tracks real Payment rows.
  // ------------------------------------------------------------------
  console.log("\n--- E. Payment status (UNPAID -> PARTIAL -> PAID) ---");
  const invoiceRes = await owner("POST", "/api/invoices", { orderId: testOrder.id });
  const invoice = as<{ invoice: WithId & { total: number } }>(invoiceRes.json).invoice;
  const orderBeforePayment = await db.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  check("paymentStatus starts UNPAID", orderBeforePayment.paymentStatus === "UNPAID", { paymentStatus: orderBeforePayment.paymentStatus });

  const half = Math.round((invoice.total / 2) * 100) / 100;
  await owner("POST", "/api/payments", { invoiceId: invoice.id, amount: half, mode: "cash", receivedAt: new Date().toISOString() });
  const orderAfterPartialPayment = await db.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  check("paymentStatus becomes PARTIAL after a half payment", orderAfterPartialPayment.paymentStatus === "PARTIAL", {
    paymentStatus: orderAfterPartialPayment.paymentStatus,
  });

  await owner("POST", "/api/payments", {
    invoiceId: invoice.id,
    amount: invoice.total - half,
    mode: "cash",
    receivedAt: new Date().toISOString(),
  });
  const orderAfterFullPayment = await db.order.findUniqueOrThrow({ where: { id: testOrder.id } });
  check("paymentStatus becomes PAID once the invoice is fully paid", orderAfterFullPayment.paymentStatus === "PAID", {
    paymentStatus: orderAfterFullPayment.paymentStatus,
  });
  check(
    "legacy status is unaffected by payment (still whatever production/dispatch derived)",
    orderAfterFullPayment.status !== "PAID",
    { status: orderAfterFullPayment.status },
  );

  console.log(`\n${passes} passed, ${failures} failed`);
  await db.$disconnect();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
