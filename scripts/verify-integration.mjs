// Cross-module end-to-end checks for the integrated app, against a running
// server on a freshly seeded database (`npm run seed`):
//
//   BASE=http://localhost:3000 node scripts/verify-integration.mjs
//
// Walks one order through every module — yarn reservation (M1), work orders
// and production logs (M2), rolls, QC and dispatch (M3), invoice and costing
// (M1/M4) — and checks each role can only do its own job. It writes real rows;
// run it on a scratch/dev database. Prints PASS/FAIL; exit code 1 on failure.

const BASE = process.env.BASE ?? "http://localhost:3000";
let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 500)}` : ""}`);
  }
}

async function login(name, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!res.ok || !cookie) throw new Error(`login as ${name} failed (${res.status})`);
  return cookie;
}

function client(cookie) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get("content-type") ?? "";
    const json = type.includes("json") ? await res.json() : null;
    return { status: res.status, json, headers: res.headers, res };
  };
}

const owner = client(await login("owner", "owner123"));
const store = client(await login("storekeeper", "store123"));
const floor = client(await login("floor", "floor123"));
const qc = client(await login("qc", "qc123"));
const anon = client(null);

// --- who can do what ---------------------------------------------------------
check("anon: rolls → 401", (await anon("GET", "/api/rolls")).status === 401);
check("storekeeper: create machine → 403", (await store("POST", "/api/machines", { name: "X", type: "loom", capacityMetresPerShift: 100 })).status === 403);
check("floor: defect analytics → 403", (await floor("GET", "/api/analytics/defects")).status === 403);
check("qc: dispatch → 403", (await qc("POST", "/api/dispatches", { buyerId: "x", truckNo: "TN 1", rollIds: ["x"] })).status === 403);
check("floor: QC inspect → 403", (await floor("POST", "/api/rolls/x/qc", { result: "PASS" })).status === 403);
check("qc: DB backup → 403", (await qc("GET", "/api/backup")).status === 403);
check("storekeeper: restore → 403", (await store("POST", "/api/restore")).status === 403);
check("floor: accounts → 403", (await floor("GET", "/api/expenses")).status === 403);

// --- seeded state each module expects ---------------------------------------
const orders = (await owner("GET", "/api/orders")).json;
const orderList = Array.isArray(orders) ? orders : orders?.orders ?? [];
const byNo = (no) => orderList.find((o) => o.orderNo === no);
check("seed: 10 orders from Module 1", orderList.length >= 10, orderList.length);
const machines = (await owner("GET", "/api/machines")).json;
const machine = (name) => machines.machines.find((m) => m.name === name);
check("seed: Module 2 machines incl. Loom 4 in breakdown", machine("Loom 4")?.status === "BREAKDOWN", machines.machines?.map((m) => m.name));
const rolls = (await owner("GET", "/api/rolls")).json;
check("seed: 80+ rolls from Module 3", Array.isArray(rolls) && rolls.length >= 80, rolls?.length);
const defects = (await owner("GET", "/api/analytics/defects?days=30")).json;
check("defects: Loom 4 callout leads", /Loom 4 produced 70% of all rejects/.test(defects?.callouts?.[0] ?? ""), defects?.callouts);
check("defects: bad days falls back to 30", (await owner("GET", "/api/analytics/defects?days=abc")).json?.timeframeDays === 30);
const qcDefects = await qc("GET", "/api/analytics/defects");
check("qc inspector can read defect analytics", qcDefects.status === 200);

// --- M1 → M2: reserve yarn, then production on a CONFIRMED order -------------
const confirmed = orderList.find((o) => o.status === "CONFIRMED");
check("an order is CONFIRMED", !!confirmed);
const lots = (await owner("GET", "/api/yarn-lots")).json;
const lotList = Array.isArray(lots) ? lots : lots?.lots ?? lots?.yarnLots ?? [];
const lot = lotList.find((l) => l.qtyRemainingKg > 100);
let wo = await floor("POST", "/api/work-orders", { orderId: confirmed.id, stage: "spinning", machineId: machine("Spinning 1").id, plannedQty: 100 });
check("work order before yarn reserved → 400 on orderId", wo.status === 400 && !!wo.json?.fieldErrors?.orderId, wo.json);
const reserve = await store("POST", `/api/orders/${confirmed.id}/reserve-yarn`, { yarnLotId: lot.id, qtyKg: 50 });
check("storekeeper reserves yarn", reserve.status === 200 || reserve.status === 201, reserve.json);
check("work order: invalid body → 400 fieldErrors", (await floor("POST", "/api/work-orders", { orderId: "x" })).json?.fieldErrors !== undefined);
const idleSpinner = machines.machines.find((m) => m.type === "spinning" && !m.currentWorkOrder);
wo = await floor("POST", "/api/work-orders", { orderId: confirmed.id, stage: "spinning", machineId: idleSpinner.id, plannedQty: 100 });
check("floor supervisor creates spinning work order", wo.status === 201, wo.json);
let after = (await owner("GET", `/api/orders/${confirmed.id}`)).json;
check("order moved CONFIRMED → IN_PRODUCTION", (after?.order ?? after)?.status === "IN_PRODUCTION", after);
await floor("PATCH", `/api/machines/${idleSpinner.id}/status`, { status: "RUNNING" });
const over = await floor("POST", "/api/production-logs", { workOrderId: wo.json.id, shift: "Morning (Shift A)", qtyProduced: 150 });
check("production log over plan → 400 on qtyProduced", over.status === 400 && !!over.json?.fieldErrors?.qtyProduced, over.json);
const logged = await floor("POST", "/api/production-logs", { workOrderId: wo.json.id, shift: "Morning (Shift A)", qtyProduced: 60 });
check("production log saved", logged.status === 201, logged.json);
const board = (await floor("GET", "/api/machines")).json.machines.find((m) => m.id === idleSpinner.id);
check("floor board shows today's metres", board?.todayMetres >= 60, board);
const audit = (await owner("GET", `/api/audit?entity=ProductionLog`)).json;
check("audit trail has the production log", (audit?.entries ?? audit?.logs ?? audit?.rows ?? []).length > 0, Object.keys(audit ?? {}));

// --- M3: mint a roll, inspect it ----------------------------------------------
const inProd = orderList.find((o) => o.orderNo === byNo("EVR-2610-004")?.orderNo);
const wos = (await owner("GET", "/api/work-orders")).json.workOrders;
const weaving = wos.find((w) => w.order.orderNo === "EVR-2610-004" && w.stage === "weaving");
const anyLot = lotList[0];
const mismatch = await floor("POST", "/api/rolls", { orderId: confirmed.id, workOrderId: weaving.id, machineId: machine("Loom 1").id, shift: "Morning (Shift A)", yarnLotId: anyLot.id, lengthMetres: 100, weightKg: 20 });
check("roll with another order's work order → 400 on workOrderId", mismatch.status === 400 && !!mismatch.json?.fieldErrors?.workOrderId, mismatch.json);
const roll = await floor("POST", "/api/rolls", { orderId: inProd.id, workOrderId: weaving.id, machineId: machine("Loom 1").id, shift: "Morning (Shift A)", yarnLotId: anyLot.id, lengthMetres: 98.5, weightKg: 21.2 });
check("floor supervisor mints a roll", roll.status === 201 && /^ROL-/.test(roll.json?.rollNo), roll.json);
const byQr = await qc("GET", `/api/rolls/by-qr/${roll.json.qrToken}`);
check("QR token resolves to the roll", byQr.json?.id === roll.json.id);
const noDefect = await qc("POST", `/api/rolls/${roll.json.id}/qc`, { result: "REJECT", defects: [] });
check("QC reject without a defect → 400 on defects", noDefect.status === 400 && !!noDefect.json?.fieldErrors?.defects, noDefect.json);
const spoofed = await qc("POST", `/api/rolls/${roll.json.id}/qc`, { result: "PASS", defects: [], inspectorId: "someone-else" });
check("QC pass saved", spoofed.status === 200, spoofed.json);
check("QC record uses the signed-in inspector, not the client's id", spoofed.json?.qcRecord?.inspectorId !== "someone-else");
const detail = (await qc("GET", `/api/rolls/${roll.json.id}`)).json;
check("roll detail names the inspector", detail?.qcRecords?.[0]?.inspectorName === "qc", detail?.qcRecords?.[0]);

// --- M3 → M1/M4: dispatch the READY order ------------------------------------
const ready = orderList.find((o) => o.status === "READY");
const readyRolls = (await store("GET", "/api/rolls")).json.filter((r) => r.orderId === ready.id);
const pass = readyRolls.filter((r) => r.qcStatus === "PASS" && !r.dispatchId);
const rework = readyRolls.filter((r) => r.qcStatus === "REWORK");
const pending = (await store("GET", "/api/rolls?qcStatus=PENDING")).json[0];
const pendingTry = await store("POST", "/api/dispatches", { buyerId: pending.order.buyerId, truckNo: "TN 01 AB 1234", rollIds: [pending.id] });
check("dispatching a PENDING roll → 400", pendingTry.status === 400 && !!pendingTry.json?.fieldErrors?.rollIds, pendingTry.json);
const otherBuyer = orderList.find((o) => o.buyerId !== ready.buyerId).buyerId;
const wrongBuyer = await store("POST", "/api/dispatches", { buyerId: otherBuyer, truckNo: "TN 01 AB 1234", rollIds: [pass[0].id] });
check("dispatching to the wrong buyer → 400", wrongBuyer.status === 400 && !!wrongBuyer.json?.fieldErrors?.buyerId, wrongBuyer.json);
check("bad truck number → 400", (await store("POST", "/api/dispatches", { buyerId: ready.buyerId, truckNo: "!!", rollIds: [pass[0].id] })).status === 400);
const truck1 = await store("POST", "/api/dispatches", { buyerId: ready.buyerId, truckNo: "TN 01 AB 1234", rollIds: pass.map((r) => r.id) });
check("storekeeper dispatches the PASS rolls", truck1.status === 201 && !!truck1.json?.invoiceId, truck1.json);
const again = await store("POST", "/api/dispatches", { buyerId: ready.buyerId, truckNo: "TN 01 AB 1234", rollIds: [pass[0].id] });
check("double dispatch of a roll → 400", again.status === 400, again.json);
after = (await owner("GET", `/api/orders/${ready.id}`)).json;
check("order stays READY while REWORK rolls are unshipped", (after?.order ?? after)?.status === "READY", (after?.order ?? after)?.status);
const invoice = (await owner("GET", `/api/invoices/${truck1.json.invoiceId}`)).json;
const inv = invoice?.invoice ?? invoice;
check("invoice = order qty × price + 5% GST (Module 1 rule)", Math.abs(inv.subtotal - ready.qtyMetres * ready.pricePerMetre) < 0.01 && Math.abs(inv.gst - inv.subtotal * 0.05) < 0.01, inv);
for (const r of rework) await qc("POST", `/api/rolls/${r.id}/qc`, { result: "PASS", defects: [] });
const truck2 = await store("POST", "/api/dispatches", { buyerId: ready.buyerId, truckNo: "TN 01 AB 1235", rollIds: rework.map((r) => r.id) });
check("re-inspected rolls ship on a second truck", truck2.status === 201 && truck2.json?.invoiceId === truck1.json.invoiceId, truck2.json);
after = (await owner("GET", `/api/orders/${ready.id}`)).json;
check("order → DISPATCHED once every non-rejected roll shipped", (after?.order ?? after)?.status === "DISPATCHED", (after?.order ?? after)?.status);

// --- M4 sees it ----------------------------------------------------------------
const cost = (await owner("GET", `/api/analytics/cost-per-order?orderId=${ready.id}`)).json;
check("costing: dispatched order is now final (invoiced)", cost?.order?.stage === "final", cost?.order?.stage);
check("costing: roll costs cover every roll", cost?.rolls?.length === readyRolls.length, [cost?.rolls?.length, readyRolls.length]);
const audits = (await owner("GET", `/api/audit?entity=Dispatch`)).json;
check("audit trail has both dispatches", (audits?.entries ?? audits?.logs ?? audits?.rows ?? []).length >= 2);
const assistant = await owner("POST", "/api/assistant/query", { question: "Which machine has the highest reject rate?" });
check("assistant answers a quality question from data", assistant.status === 200 && /Loom 4/.test(JSON.stringify(assistant.json)), assistant.json?.answer);

// --- backup + old links ----------------------------------------------------------
const backup = await owner("GET", "/api/backup");
const head = Buffer.from(await backup.res.arrayBuffer()).subarray(0, 15).toString();
check("owner downloads a SQLite backup", backup.status === 200 && head === "SQLite format 3", head);
const old = await owner("GET", "/qc");
check("old /qc link redirects to /quality/qc", [307, 308].includes(old.status) && old.headers.get("location")?.endsWith("/quality/qc"), old.status);
check("manifest is public", (await anon("GET", "/manifest.json")).status === 200);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
