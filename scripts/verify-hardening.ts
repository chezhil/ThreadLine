// End-to-end checks for the hardening work (ledger, approvals, offline QC
// conflicts, outbox alerts, month-end CSV) against a running server, plus
// ledger invariants read straight from the database.
//
//   BASE=http://localhost:3000 DATABASE_URL="file:./dev.db" npx tsx scripts/verify-hardening.ts
//
// Writes real rows; run it against a freshly seeded scratch database.
/* eslint-disable @typescript-eslint/no-explicit-any -- the checks read loosely shaped JSON responses */
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const db = new PrismaClient();
let passes = 0;
let failures = 0;

function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
  }
}

async function login(name: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!res.ok || !cookie) throw new Error(`login as ${name} failed (${res.status})`);
  return cookie;
}

type Res = { status: number; json: any; text: string; headers: Headers };
function client(cookie: string | null) {
  return async (method: string, path: string, body?: unknown): Promise<Res> => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* CSV or HTML */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
}

const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const thisMonth = () => istToday().slice(0, 7);
const nextMonth = () => {
  const [y, m] = thisMonth().split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};
const id = () => `verify-${Math.random().toString(36).slice(2)}-${Date.now()}`;

async function ledgerFor(sourceType: string, sourceId: string) {
  return db.ledgerEntry.findMany({ where: { sourceType, sourceId } });
}

async function main() {
  const ownerCookie = await login("owner", "owner123");
  const owner = client(ownerCookie);
  const store = client(await login("storekeeper", "store123"));
  const floor = client(await login("floor", "floor123"));
  const qc = client(await login("qc", "qc123"));
  const anon = client(null);

  // ---------------------------------------------------------------- ledger
  console.log("\n# Ledger");
  const open = await owner("GET", "/api/payments");
  const inv = (open.json?.invoices ?? []).find((i: any) => i.outstanding > 100);
  check("an invoice with a balance exists to pay", inv, open.json);
  if (inv) {
    const mid = id();
    const first = await owner("POST", "/api/payments", { invoiceId: inv.id, amount: 50, mode: "upi", receivedAt: istToday(), clientMutationId: mid });
    check("payment recorded (201)", first.status === 201, first.json);
    const again = await owner("POST", "/api/payments", { invoiceId: inv.id, amount: 50, mode: "upi", receivedAt: istToday(), clientMutationId: mid });
    check("same clientMutationId replays (200, same payment)", again.status === 200 && again.json?.payment?.id === mid, again.json);
    check("replayed payment carries no nested invoice", again.json?.payment && !("invoice" in again.json.payment), again.json);
    const led = await ledgerFor("Payment", mid);
    check("exactly one payment_received ledger entry", led.length === 1 && led[0].type === "payment_received" && led[0].amount === 50, led);

    const otherInv = (open.json?.invoices ?? []).find((i: any) => i.id !== inv.id);
    if (otherInv) {
      const cross = await owner("POST", "/api/payments", { invoiceId: otherInv.id, amount: 1, mode: "upi", receivedAt: istToday(), clientMutationId: mid });
      check("same payment id for another invoice → 409", cross.status === 409, cross.json);
    }

    const rid = id();
    const burst = await Promise.all(
      Array.from({ length: 6 }, () =>
        owner("POST", "/api/payments", { invoiceId: inv.id, amount: 10, mode: "neft", receivedAt: istToday(), clientMutationId: rid }),
      ),
    );
    check("6 concurrent replays of one payment: no 5xx", burst.every((r) => r.status === 200 || r.status === 201), burst.map((r) => r.status));
    check("…and exactly one payment row", (await db.payment.count({ where: { id: rid } })) === 1);
    check("…and exactly one ledger entry", (await ledgerFor("Payment", rid)).length === 1);

    const tooLong = await owner("POST", "/api/payments", { invoiceId: inv.id, amount: 1, mode: "upi", receivedAt: istToday(), clientMutationId: "x".repeat(101) });
    check("over-long clientMutationId → 400", tooLong.status === 400, tooLong.json);
  }

  const exp = await owner("POST", "/api/expenses", { category: "power", amount: 1234.5, date: istToday(), note: "verify" });
  check("expense recorded", exp.status === 201, exp.json);
  if (exp.json?.expense) {
    const led = await ledgerFor("Expense", exp.json.expense.id);
    check("power expense → one power_cost ledger entry", led.length === 1 && led[0].type === "power_cost" && led[0].amount === 1234.5, led);
  }

  const uninvoiced = await db.order.findFirst({ where: { status: { not: "NEW" }, invoices: { none: {} } } });
  if (uninvoiced) {
    const r = await owner("POST", "/api/invoices", { orderId: uninvoiced.id });
    check("invoice raised for a confirmed order", r.status === 201, r.json);
    if (r.json?.invoice) {
      const led = await ledgerFor("Invoice", r.json.invoice.id);
      check("invoice → one revenue ledger entry at the ex-GST subtotal", led.length === 1 && led[0].type === "revenue" && led[0].amount === r.json.invoice.subtotal && led[0].orderId === uninvoiced.id, led);
    }
  } else {
    check("an uninvoiced confirmed order exists for the invoice check", false);
  }

  check("ledger: no params → 400", (await owner("GET", "/api/ledger")).status === 400);
  check("ledger: limit=abc → 400 (not 500)", (await owner("GET", `/api/ledger?orderId=x&limit=abc`)).status === 400);
  check("ledger: qc → 403", (await qc("GET", `/api/ledger?orderId=x`)).status === 403);
  check("ledger: signed out → 403/401", [401, 403].includes((await anon("GET", `/api/ledger?orderId=x`)).status));
  check("outbox: limit=-5 → 400 (not 500)", (await owner("GET", "/api/alerts/outbox?limit=-5")).status === 400);

  // ------------------------------------------------------- purchase requests
  console.log("\n# Purchase requests");
  const yarn = await db.yarnType.findFirstOrThrow({ where: { purchaseRequests: { none: {} } } });
  check("qc can't raise a purchase request", (await qc("POST", "/api/purchase-requests", { yarnTypeId: yarn.id, qtyKg: 10 })).status === 403);
  check("floor can't raise a purchase request", (await floor("POST", "/api/purchase-requests", { yarnTypeId: yarn.id, qtyKg: 10 })).status === 403);
  check("qty 0 → 400", (await store("POST", "/api/purchase-requests", { yarnTypeId: yarn.id, qtyKg: 0 })).status === 400);
  check("unknown yarn → 400", (await store("POST", "/api/purchase-requests", { yarnTypeId: "nope", qtyKg: 5 })).status === 400);
  const notesBefore = await db.notification.count({ where: { type: "approval_requested" } });
  const pr = await store("POST", "/api/purchase-requests", { yarnTypeId: yarn.id, qtyKg: 120, note: "verify" });
  check("storekeeper raises a purchase request", pr.status === 201 && pr.json?.request?.status === "PENDING", pr.json);
  check("owner is notified of the request", (await db.notification.count({ where: { type: "approval_requested" } })) === notesBefore + 1);
  const dupPr = await store("POST", "/api/purchase-requests", { yarnTypeId: yarn.id, qtyKg: 50 });
  check("second open request for the same yarn → 409", dupPr.status === 409, dupPr.json);
  const parallelPr = await Promise.all(
    Array.from({ length: 4 }, () => store("POST", "/api/purchase-requests", { yarnTypeId: yarn.id, qtyKg: 5 })),
  );
  check("concurrent duplicates all refused", parallelPr.every((r) => r.status === 409), parallelPr.map((r) => r.status));
  check("storekeeper sees the queue but can't approve", (await store("GET", "/api/purchase-requests")).json?.canApprove === false);
  if (pr.json?.request) {
    const path = `/api/purchase-requests/${pr.json.request.id}`;
    check("storekeeper can't decide", (await store("PATCH", path, { status: "APPROVED" })).status === 403);
    check("bad status → 400", (await owner("PATCH", path, { status: "MAYBE" })).status === 400);
    const race = await Promise.all(Array.from({ length: 5 }, () => owner("PATCH", path, { status: "APPROVED" })));
    check("5 concurrent approvals: exactly one succeeds", race.filter((r) => r.status === 200).length === 1, race.map((r) => r.status));
    check("…the rest are 409, not 5xx", race.filter((r) => r.status === 409).length === 4, race.map((r) => r.status));
    check("decided request can't be flipped to rejected", (await owner("PATCH", path, { status: "REJECTED" })).status === 409);
    const row = await db.purchaseRequest.findUniqueOrThrow({ where: { id: pr.json.request.id } });
    check("request is APPROVED with approver and time", row.status === "APPROVED" && !!row.approvedBy && !!row.approvedAt, row);
    check("unknown id → 404", (await owner("PATCH", "/api/purchase-requests/nope", { status: "APPROVED" })).status === 404);
    const again = await store("POST", "/api/purchase-requests", { yarnTypeId: yarn.id, qtyKg: 30 });
    check("after a decision a new request for that yarn is allowed", again.status === 201, again.json);
  }

  // ---------------------------------------------------- maintenance requests
  console.log("\n# Maintenance requests");
  const mName = `Verify Loom ${Date.now()}`;
  const machine = await owner("POST", "/api/machines", { name: mName, type: "loom", capacityMetresPerShift: 100 });
  check("test machine created", machine.status === 201, machine.json);
  const mid = machine.json?.id;
  check("storekeeper can't raise maintenance", (await store("POST", "/api/maintenance-requests", { machineId: mid, description: "x" })).status === 403);
  check("blank description → 400", (await floor("POST", "/api/maintenance-requests", { machineId: mid, description: "   " })).status === 400);
  const mr = await floor("POST", "/api/maintenance-requests", { machineId: mid, description: "Shuttle jams every 20 m" });
  check("floor supervisor raises maintenance", mr.status === 201, mr.json);
  check("second open request for the machine → 409", (await floor("POST", "/api/maintenance-requests", { machineId: mid, description: "again" })).status === 409);
  const del = await owner("DELETE", `/api/machines/${mid}`);
  check("machine with a maintenance request can't be deleted (409, not 500)", del.status === 409, del);
  if (mr.json?.request) {
    const path = `/api/maintenance-requests/${mr.json.request.id}`;
    check("negative cost → 400", (await owner("PATCH", path, { status: "APPROVED", cost: -5 })).status === 400);
    const ok = await owner("PATCH", path, { status: "APPROVED", cost: 2500 });
    check("owner approves with a cost estimate", ok.status === 200 && ok.json?.request?.cost === 2500, ok.json);
  }
  const mr2 = await floor("POST", "/api/maintenance-requests", { machineId: mid, description: "Motor noise" });
  if (mr2.json?.request) {
    const rej = await owner("PATCH", `/api/maintenance-requests/${mr2.json.request.id}`, { status: "REJECTED", cost: 999 });
    check("rejecting ignores a cost", rej.status === 200 && rej.json?.request?.cost === null, rej.json);
  }

  // ------------------------------------------------------------ payouts
  console.log("\n# Payout approvals");
  check("storekeeper can't see payouts", (await store("GET", "/api/payout-approvals")).status === 403);
  check("future month → 400", (await owner("POST", "/api/payout-approvals", { month: nextMonth() })).status === 400);
  check("month with no attendance → 400", (await owner("POST", "/api/payout-approvals", { month: "2020-01" })).status === 400);
  check("bad month format → 400", (await owner("POST", "/api/payout-approvals", { month: "2026-13" })).status === 400);
  const month = thisMonth();
  const marks = await db.attendance.count({ where: { date: { gte: new Date(`${month}-01T00:00:00+05:30`) } } });
  check("seed has attendance this month", marks > 0, marks);
  const raised = await owner("POST", "/api/payout-approvals", { month });
  check("payout raised for this month", raised.status === 201 && raised.json?.request?.totalWages > 0, raised.json);
  check("second payout for the month → 409", (await owner("POST", "/api/payout-approvals", { month })).status === 409);
  if (raised.json?.request) {
    const req = raised.json.request;
    // Attendance changes after the request: approving must not pay the stale total.
    const worker = await owner("POST", "/api/workers", { name: `Verify Worker ${Date.now()}`, role: "weaver", dailyWage: 777 });
    check("test worker created", worker.status === 201, worker.json);
    const mark = await owner("POST", "/api/attendance", {
      date: istToday(),
      shift: "Morning (Shift A)",
      entries: [{ workerId: worker.json?.worker?.id, status: "present" }],
    });
    check("attendance marked after the payout was raised", mark.status === 200 || mark.status === 201, mark.json);
    const stale = await owner("PATCH", `/api/payout-approvals/${req.id}`, { status: "APPROVED" });
    check("approving a stale total → 409 with the new figure", stale.status === 409, stale.json);
    const refreshed = await db.payoutApproval.findUniqueOrThrow({ where: { id: req.id } });
    check("request total refreshed (+₹777)", Math.abs(refreshed.totalWages - (req.totalWages + 777)) < 0.01, { before: req.totalWages, after: refreshed.totalWages });
    check("no expense was created by the refused approval", (await db.expense.count({ where: { note: { contains: "Wage payout" } } })) === 0);

    const race = await Promise.all(Array.from({ length: 5 }, () => owner("PATCH", `/api/payout-approvals/${req.id}`, { status: "APPROVED" })));
    check("5 concurrent payout approvals: exactly one succeeds", race.filter((r) => r.status === 200).length === 1, race.map((r) => r.status));
    const expenses = await db.expense.findMany({ where: { note: { contains: "Wage payout" } } });
    check("exactly one wages expense, for the refreshed total", expenses.length === 1 && expenses[0].category === "wages" && Math.abs(expenses[0].amount - refreshed.totalWages) < 0.01, expenses);
    if (expenses[0]) {
      const led = await ledgerFor("Expense", expenses[0].id);
      check("…with exactly one wage_cost ledger entry", led.length === 1 && led[0].type === "wage_cost", led);
      const approved = await db.payoutApproval.findUniqueOrThrow({ where: { id: req.id } });
      check("approval links the expense", approved.expenseId === expenses[0].id && approved.status === "APPROVED", approved);
    }
  }
  // Reject, then raise the same month again.
  const lastMonthKey = (() => {
    const [y, m] = month.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const prev = await owner("POST", "/api/payout-approvals", { month: lastMonthKey });
  if (prev.status === 201) {
    const rej = await owner("PATCH", `/api/payout-approvals/${prev.json.request.id}`, { status: "REJECTED" });
    check("payout rejected", rej.status === 200 && rej.json?.request?.status === "REJECTED", rej.json);
    check("rejecting creates no expense", rej.json?.request?.expenseId === null);
    const reraise = await owner("POST", "/api/payout-approvals", { month: lastMonthKey });
    check("a rejected month can be raised again (back to PENDING)", reraise.status === 201 && reraise.json?.request?.status === "PENDING" && reraise.json.request.id === prev.json.request.id, reraise.json);
  } else {
    check(`payout for ${lastMonthKey} (seeded attendance)`, prev.status === 400, prev.json);
  }

  // -------------------------------------------------------- QC conflicts
  console.log("\n# QC conflicts");
  const pending = await db.roll.findFirst({ where: { qcStatus: "PENDING", dispatchId: null } });
  check("a PENDING roll exists", pending);
  if (pending) {
    const path = `/api/rolls/${pending.id}/qc`;
    const a = await qc("POST", path, { result: "PASS", defects: [], baseQcStatus: "PENDING", clientMutationId: id() });
    check("inspection against the current status succeeds", a.status === 200, a.json);
    const replayId = id();
    const b = await qc("POST", path, { result: "REJECT", defects: ["hole"], baseQcStatus: "PENDING", clientMutationId: replayId });
    check("inspection against a stale status → 409 conflict", b.status === 409 && b.json?.conflict === true && b.json?.currentQcStatus === "PASS", b.json);
    check("…and nothing was written", (await db.qCRecord.count({ where: { id: replayId } })) === 0);
    const c = await qc("POST", path, { result: "REWORK", defects: ["hole"], baseQcStatus: "PASS", clientMutationId: id() });
    check("re-inspecting against the fresh status succeeds", c.status === 200, c.json);
    const replay = await qc("POST", path, { result: "REWORK", defects: ["hole"], baseQcStatus: "PASS", clientMutationId: c.json?.qcRecord?.id });
    check("replaying an applied inspection is idempotent even though the base moved", replay.status === 200 && replay.json?.qcRecord?.id === c.json?.qcRecord?.id, replay.json);
    check("baseQcStatus must be a real status", (await qc("POST", path, { result: "PASS", defects: [], baseQcStatus: "MAYBE" })).status === 400);
  }

  // ------------------------------------------------------ dispatch + outbox
  console.log("\n# Dispatch, ledger and outbox");
  const ready = await db.order.findFirst({
    where: { status: "READY", rolls: { some: { qcStatus: "PASS", dispatchId: null } } },
    include: { rolls: true },
  });
  if (ready) {
    // Pass the order's remaining REWORK/PENDING rolls so the whole order ships.
    for (const r of ready.rolls.filter((r) => (r.qcStatus === "REWORK" || r.qcStatus === "PENDING") && !r.dispatchId)) {
      const q = await qc("POST", `/api/rolls/${r.id}/qc`, { result: "PASS", defects: [], baseQcStatus: r.qcStatus });
      check(`re-inspected ${r.rollNo} as PASS`, q.status === 200, q.json);
    }
    const shipping = await db.roll.findMany({ where: { orderId: ready.id, qcStatus: "PASS", dispatchId: null } });
    const before = await db.alertDelivery.count({ where: { templateName: "order_dispatched" } });
    const invoicesBefore = await db.invoice.count({ where: { orderId: ready.id } });
    const d = await store("POST", "/api/dispatches", { buyerId: ready.buyerId, truckNo: "MH12AB1234", rollIds: shipping.map((r) => r.id) });
    check("storekeeper dispatches a READY order's rolls", d.status === 201, d.json);
    const after = await db.order.findUniqueOrThrow({ where: { id: ready.id } });
    const inv = await db.invoice.findFirst({ where: { orderId: ready.id } });
    check("order has its invoice", !!inv);
    if (inv && invoicesBefore === 0) check("new dispatch invoice posted revenue to the ledger", (await ledgerFor("Invoice", inv.id)).length === 1);
    check("order is DISPATCHED once every good roll has shipped", after.status === "DISPATCHED" && after.dispatchStatus === "FULLY_DISPATCHED", after);
    const alerts = await db.alertDelivery.findMany({ where: { templateName: "order_dispatched" }, orderBy: { createdAt: "desc" } });
    check("…and queued exactly one buyer 'dispatched' alert", alerts.length === before + 1 && JSON.parse(alerts[0].payload).orderNo === ready.orderNo, alerts[0]);
    const again = await store("POST", "/api/dispatches", { buyerId: ready.buyerId, truckNo: "MH12AB1234", rollIds: [shipping[0].id] });
    check("a shipped roll can't ship again", again.status === 400, again.json);
  } else {
    check("a READY order with PASS rolls exists for the dispatch check", false);
  }
  const drain = await owner("POST", "/api/alerts/outbox/process");
  check("outbox drains", drain.status === 200 && typeof drain.json?.processed === "number", drain.json);
  check("outbox process is owner-only", (await store("POST", "/api/alerts/outbox/process")).status === 403);

  // ------------------------------------------------------------- CSV export
  console.log("\n# Month-end CSV");
  const csv = await owner("GET", `/api/accounts/month-end/export?month=${month}`);
  const csvBytes = new Uint8Array(
    await (await fetch(`${BASE}/api/accounts/month-end/export?month=${month}`, { headers: { cookie: ownerCookie } })).arrayBuffer(),
  );
  check("CSV export 200 text/csv", csv.status === 200 && (csv.headers.get("content-type") ?? "").includes("text/csv"), csv.status);
  check("CSV starts with a UTF-8 BOM and the title", csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && csv.text.includes("month-end report"));
  check("CSV attachment filename", (csv.headers.get("content-disposition") ?? "").includes(`threadline-month-end-${month}.csv`));
  check("CSV bad month → 400", (await owner("GET", "/api/accounts/month-end/export?month=13-2026")).status === 400);
  check("CSV is owner-only", (await store("GET", `/api/accounts/month-end/export?month=${month}`)).status === 403);

  // ---------------------------------------------------- ledger invariants
  console.log("\n# Ledger invariants (database)");
  const [invoices, payments, expensesAll, entries] = await Promise.all([
    db.invoice.findMany({ select: { id: true, subtotal: true, orderId: true } }),
    db.payment.findMany({ select: { id: true, amount: true, invoice: { select: { orderId: true } } } }),
    db.expense.findMany({ select: { id: true, amount: true, orderId: true } }),
    db.ledgerEntry.findMany(),
  ]);
  const bySource = new Map<string, typeof entries>();
  for (const e of entries) bySource.set(`${e.sourceType}:${e.sourceId}`, [...(bySource.get(`${e.sourceType}:${e.sourceId}`) ?? []), e]);
  const bad: string[] = [];
  for (const i of invoices) {
    const l = bySource.get(`Invoice:${i.id}`) ?? [];
    if (l.length !== 1 || Math.abs(l[0].amount - i.subtotal) > 0.005 || l[0].orderId !== i.orderId) bad.push(`invoice ${i.id}`);
  }
  for (const p of payments) {
    const l = bySource.get(`Payment:${p.id}`) ?? [];
    if (l.length !== 1 || Math.abs(l[0].amount - p.amount) > 0.005 || l[0].orderId !== p.invoice.orderId) bad.push(`payment ${p.id}`);
  }
  for (const x of expensesAll) {
    const l = bySource.get(`Expense:${x.id}`) ?? [];
    if (l.length !== 1 || Math.abs(l[0].amount - x.amount) > 0.005) bad.push(`expense ${x.id}`);
  }
  check(`every invoice/payment/expense has exactly one matching ledger entry (${invoices.length + payments.length + expensesAll.length} rows)`, bad.length === 0, bad.slice(0, 10));
  const orphans = entries.filter((e) => !["Invoice", "Payment", "Expense"].includes(e.sourceType));
  check("no ledger entry with an unknown source type", orphans.length === 0, orphans.slice(0, 3));

  // Payment status agrees with the ledger for every invoiced order.
  const orders = await db.order.findMany({ where: { invoices: { some: {} } }, include: { invoices: true } });
  const wrong: string[] = [];
  for (const o of orders) {
    const total = o.invoices.reduce((s, i) => s + i.total, 0);
    const paid = entries.filter((e) => e.orderId === o.id && e.type === "payment_received").reduce((s, e) => s + e.amount, 0);
    const expected = paid <= 0.005 ? "UNPAID" : paid + 0.005 >= total ? "PAID" : "PARTIAL";
    if (o.paymentStatus !== expected) wrong.push(`${o.orderNo}: ${o.paymentStatus} vs ${expected}`);
  }
  check(`paymentStatus matches the ledger on all ${orders.length} invoiced orders`, wrong.length === 0, wrong);

  console.log(`\n${passes} passed, ${failures} failed`);
  await db.$disconnect();
  if (failures) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
