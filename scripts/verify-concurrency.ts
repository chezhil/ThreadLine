// Concurrency checks for the three write paths the spec calls out: stock
// reservation, dispatch, and invoice numbering. Fires real concurrent HTTP
// requests at a running server (not direct DB calls) so it exercises the
// actual route handlers, then asserts the DB ended up consistent — no
// negative stock, no double-dispatched roll, no duplicate invoice.
//
//   npm run dev                 (separate terminal)
//   BASE=http://localhost:3000 npx tsx scripts/verify-concurrency.ts
//
// Run against a scratch/dev database, not one you care about — it creates
// real test rows (a yarn type/lot, orders).

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

/** The scripts in this file only need a couple of fields back from each
 * response — this just names the shape instead of reaching for `any`. */
function as<T>(json: unknown): T {
  return json as T;
}
interface WithId {
  id: string;
}

async function main() {
  const owner = client(await login(process.env.OWNER ?? "owner", process.env.OWNER_PW ?? "owner123"));
  const anyBuyer = await db.buyer.findFirstOrThrow();

  // ------------------------------------------------------------------
  // A. Yarn reservation: 5 concurrent requests × 30kg against a 100kg lot
  //    (150kg contested) must leave exactly 10kg, not negative, and
  //    exactly 3 of the 5 requests should succeed.
  // ------------------------------------------------------------------
  console.log("\n--- A. Yarn reservation race (stock can't go negative) ---");
  const yarnType = as<{ yarnType: WithId }>(
    (
      await owner("POST", "/api/yarn-types", {
        name: `Concurrency Test Yarn ${Date.now()}`, // unique per run: yarn types are unique by name/count/colour
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
        lotNo: `CONC-TEST-${Date.now()}`,
        qtyReceivedKg: 100,
        receivedAt: new Date().toISOString(),
      })
    ).json,
  ).yarnLot;
  const reserveOrder = as<{ order: WithId }>(
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

  const reserveResults = await Promise.all(
    Array.from({ length: 5 }, () =>
      owner("POST", `/api/orders/${reserveOrder.id}/reserve-yarn`, { yarnLotId: yarnLot.id, qtyKg: 30 }),
    ),
  );
  const reserveSucceeded = reserveResults.filter((r) => r.status === 201).length;
  const reserveFailed = reserveResults.filter((r) => r.status === 400).length;
  const finalLot = await db.yarnLot.findUniqueOrThrow({ where: { id: yarnLot.id } });

  check("exactly 3 of 5 reservations succeeded (30kg × 3 = 90kg of 100kg)", reserveSucceeded === 3, {
    succeeded: reserveSucceeded,
    statuses: reserveResults.map((r) => r.status),
  });
  check("exactly 2 of 5 reservations rejected as insufficient stock", reserveFailed === 2, { failed: reserveFailed });
  check("stock never went negative, and the lot is exactly 10kg left (not 10, not -20)", finalLot.qtyRemainingKg === 10, {
    qtyRemainingKg: finalLot.qtyRemainingKg,
  });

  // ------------------------------------------------------------------
  // B. Invoice numbering: 8 concurrent POST /api/invoices for the same
  //    order must produce exactly one invoice, not eight.
  // ------------------------------------------------------------------
  console.log("\n--- B. Invoice numbering race (one order, one invoice) ---");
  const invoiceOrder = as<{ order: WithId }>(
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

  // Invoices are only raised for confirmed orders.
  await owner("PATCH", `/api/orders/${invoiceOrder.id}`, { status: "CONFIRMED" });
  const invoiceResults = await Promise.all(
    Array.from({ length: 8 }, () => owner("POST", "/api/invoices", { orderId: invoiceOrder.id })),
  );
  const invoiceOkCount = invoiceResults.filter((r) => r.status === 200 || r.status === 201).length;
  const invoiceIds = new Set(
    invoiceResults.map((r) => as<{ invoice?: WithId }>(r.json).invoice?.id).filter(Boolean),
  );
  const invoiceRowsInDb = await db.invoice.count({ where: { orderId: invoiceOrder.id } });

  check("all 8 concurrent requests succeeded (idempotent, not a race failure)", invoiceOkCount === 8, {
    statuses: invoiceResults.map((r) => r.status),
  });
  check("all 8 responses point at the same invoice id", invoiceIds.size === 1, { distinctIds: [...invoiceIds] });
  check("exactly one Invoice row exists for the order, not eight", invoiceRowsInDb === 1, { invoiceRowsInDb });

  // ------------------------------------------------------------------
  // C. The bug this was written to catch: concurrent dispatches of
  //    DIFFERENT rolls from the same uninvoiced order (no roll-claim
  //    conflict between them) must still produce exactly one invoice for
  //    that order, not one per request. Runs before D so it gets first
  //    pick of the best multi-roll uninvoiced order.
  // ------------------------------------------------------------------
  console.log("\n--- C. Dispatching different rolls of one order concurrently: one invoice, not N ---");
  const uninvoicedOrders = await db.order.findMany({
    where: { invoices: { none: {} } },
    include: { rolls: { where: { qcStatus: "PASS", dispatchId: null } } },
  });
  const multiRollOrder = uninvoicedOrders.sort((a, b) => b.rolls.length - a.rolls.length)[0];
  if (!multiRollOrder || multiRollOrder.rolls.length < 3) {
    console.log("SKIP  no seeded order with 3+ undispatched PASS rolls and no invoice — run `npm run seed` first");
  } else {
    const rollsToUse = multiRollOrder.rolls.slice(0, 3);
    const multiResults = await Promise.all(
      rollsToUse.map((roll) =>
        owner("POST", "/api/dispatches", {
          buyerId: multiRollOrder.buyerId,
          truckNo: `TEST-C-${Date.now()}`,
          rollIds: [roll.id],
        }),
      ),
    );
    const multiOk = multiResults.filter((r) => r.status === 201).length;
    const invoicesForOrder = await db.invoice.count({ where: { orderId: multiRollOrder.id } });

    check("all 3 concurrent dispatches of distinct rolls succeeded", multiOk === 3, {
      statuses: multiResults.map((r) => r.status),
    });
    check("exactly one invoice was created for the order despite 3 concurrent dispatches", invoicesForOrder === 1, {
      invoicesForOrder,
    });
  }

  // ------------------------------------------------------------------
  // D. Dispatch: 5 concurrent requests to dispatch the SAME roll must let
  //    exactly one through. Picks any spare PASS/undispatched roll —
  //    doesn't need an uninvoiced order, that's C's concern.
  // ------------------------------------------------------------------
  console.log("\n--- D. Dispatch race: same roll claimed twice ---");
  const spareRollOrder = (
    await db.order.findMany({ include: { rolls: { where: { qcStatus: "PASS", dispatchId: null } } } })
  ).find((o) => o.rolls.length > 0);
  if (!spareRollOrder) {
    console.log("SKIP  no PASS/undispatched roll left anywhere — run `npm run seed` first");
  } else {
    const roll = spareRollOrder.rolls[0];
    const dispatchResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        owner("POST", "/api/dispatches", {
          buyerId: spareRollOrder.buyerId,
          truckNo: `TEST-D-${Date.now()}`,
          rollIds: [roll.id],
        }),
      ),
    );
    const dispatchOk = dispatchResults.filter((r) => r.status === 201).length;
    const dispatchRejected = dispatchResults.filter((r) => r.status === 400).length;
    const dispatchRowsForRoll = await db.dispatch.count({ where: { rolls: { some: { id: roll.id } } } });

    check("exactly 1 of 5 concurrent dispatches of the same roll succeeded", dispatchOk === 1, {
      statuses: dispatchResults.map((r) => r.status),
    });
    check("the other 4 were rejected, not silently duplicated", dispatchRejected === 4, { rejected: dispatchRejected });
    check("exactly one Dispatch row references the roll", dispatchRowsForRoll === 1, { dispatchRowsForRoll });
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  await db.$disconnect();
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
