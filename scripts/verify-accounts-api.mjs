// End-to-end checks for Module 4's API against a running server.
//
//   BASE=http://localhost:3000 OWNER=owner OWNER_PW=owner123 OTHER=qc OTHER_PW=qc123 \
//     node scripts/verify-accounts-api.mjs
//
// It writes real rows (a test worker, attendance, an expense, a payment) and
// prints PASS/FAIL per check; exit code 1 if anything failed. Run it against a
// scratch/dev database, not a demo database you care about.

const BASE = process.env.BASE ?? "http://localhost:3000";
let failures = 0;
let passes = 0;

function check(name, cond, detail) {
  if (cond) {
    passes++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 400)}` : ""}`);
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
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON (e.g. 404 page) */
    }
    return { status: res.status, json };
  };
}

const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const tomorrow = () => new Date(Date.now() + 36 * 3600_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const owner = client(await login(process.env.OWNER ?? "owner", process.env.OWNER_PW ?? "owner123"));
const other = client(await login(process.env.OTHER ?? "qc", process.env.OTHER_PW ?? "qc123"));
const anon = client(null);

// --- access control --------------------------------------------------------
check("no session → 401", (await anon("GET", "/api/expenses")).status === 401);
for (const p of ["/api/workers", "/api/attendance", "/api/expenses", "/api/payments", "/api/audit", "/api/analytics/cost-per-order", "/api/analytics/profit-month"]) {
  check(`non-owner GET ${p} → 403`, (await other("GET", p)).status === 403);
}
check("non-owner POST /api/assistant/query → 403", (await other("POST", "/api/assistant/query", { question: "profit?" })).status === 403);
check("any role can read alerts", (await other("GET", "/api/alerts")).status === 200);

// --- workers ---------------------------------------------------------------
let r = await owner("POST", "/api/workers", { name: "", role: "astronaut", dailyWage: -5 });
check("worker: invalid input → 400 with fieldErrors", r.status === 400 && r.json?.fieldErrors?.name && r.json.fieldErrors.role && r.json.fieldErrors.dailyWage, r.json);
r = await owner("POST", "/api/workers", { name: "Test", role: "helper", dailyWage: 500.123 });
check("worker: more than 2 decimals rejected", r.status === 400 && r.json?.fieldErrors?.dailyWage, r.json);
const wname = `Verify Worker ${Date.now()}`;
r = await owner("POST", "/api/workers", { name: wname, role: "weaver", dailyWage: 800 });
check("worker: create → 201", r.status === 201 && r.json?.worker?.id, r.json);
const workerId = r.json?.worker?.id;
r = await owner("POST", "/api/workers", { name: wname, role: "weaver", dailyWage: 800 });
check("worker: duplicate name → 409", r.status === 409 && r.json?.fieldErrors?.name, r.json);
r = await owner("PATCH", `/api/workers/${workerId}`, { dailyWage: 825 });
check("worker: update wage", r.status === 200 && r.json?.worker?.dailyWage === 825, r.json);
r = await owner("PATCH", `/api/workers/${workerId}`, {});
check("worker: empty update → 400", r.status === 400, r.json);

// --- attendance --------------------------------------------------------------
const shift = "Morning (Shift A)";
r = await owner("POST", "/api/attendance", { date: tomorrow(), shift, entries: [{ workerId, status: "present" }] });
check("attendance: future date → 400", r.status === 400 && r.json?.fieldErrors?.date, r.json);
r = await owner("POST", "/api/attendance", { date: istToday(), shift, entries: [{ workerId, status: "absent", machineId: "x" }] });
check("attendance: absent with machine → 400 on that row", r.status === 400 && r.json?.fieldErrors?.["entries.0.machineId"], r.json);
r = await owner("POST", "/api/attendance", { date: istToday(), shift, entries: [{ workerId, status: "present" }, { workerId, status: "absent" }] });
check("attendance: same worker twice → 400", r.status === 400 && r.json?.fieldErrors?.entries, r.json);
r = await owner("POST", "/api/attendance", { date: istToday(), shift, entries: [{ workerId: "nope", status: "present" }] });
check("attendance: unknown worker → 400", r.status === 400 && r.json?.fieldErrors?.["entries.0.workerId"], r.json);
r = await owner("POST", "/api/attendance", { date: istToday(), shift, entries: [{ workerId, status: "present" }] });
check("attendance: save → 1 created", r.status === 201 && r.json?.created === 1, r.json);
r = await owner("POST", "/api/attendance", { date: istToday(), shift, entries: [{ workerId, status: "present" }] });
check("attendance: same mark again → unchanged, not duplicated", r.status === 201 && r.json?.created === 0 && r.json?.unchanged === 1, r.json);
r = await owner("POST", "/api/attendance", { date: istToday(), shift, entries: [{ workerId, status: "half_day" }] });
check("attendance: change mark → updated", r.status === 201 && r.json?.updated === 1, r.json);
r = await owner("GET", `/api/attendance?date=${istToday()}&shift=${encodeURIComponent(shift)}`);
const mine = r.json?.marks?.filter((m) => m.workerId === workerId) ?? [];
check("attendance: exactly one mark for worker/date/shift", mine.length === 1 && mine[0].status === "half_day", r.json);
r = await owner("GET", "/api/attendance?month=2026-13");
check("attendance: bad month → 400", r.status === 400, r.json);
r = await owner("DELETE", `/api/workers/${workerId}`);
check("worker: delete blocked when attendance exists → 409", r.status === 409 && r.json?.fieldErrors?._form, r.json);

// --- expenses ----------------------------------------------------------------
r = await owner("POST", "/api/expenses", { category: "power", amount: 0, date: istToday() });
check("expense: zero amount → 400", r.status === 400 && r.json?.fieldErrors?.amount, r.json);
r = await owner("POST", "/api/expenses", { category: "power", amount: 100, date: tomorrow() });
check("expense: future date → 400", r.status === 400 && r.json?.fieldErrors?.date, r.json);
r = await owner("POST", "/api/expenses", { category: "power", amount: 100, date: istToday(), orderId: "missing" });
check("expense: unknown order → 400", r.status === 400 && r.json?.fieldErrors?.orderId, r.json);
r = await owner("POST", "/api/expenses", { category: "rent", amount: 100, date: istToday() });
check("expense: unknown category → 400", r.status === 400 && r.json?.fieldErrors?.category, r.json);
const before = await owner("GET", "/api/analytics/profit-month");
r = await owner("POST", "/api/expenses", { category: "power", amount: 1234.5, date: istToday(), note: "verify script" });
check("expense: create → 201", r.status === 201, r.json);
const after = await owner("GET", "/api/analytics/profit-month");
check(
  "expense: month summary power total rises by exactly 1234.5",
  Math.abs(after.json.cash.expensesByCategory.power - before.json.cash.expensesByCategory.power - 1234.5) < 0.001,
  [before.json?.cash, after.json?.cash],
);

// --- payments ----------------------------------------------------------------
r = await owner("GET", "/api/payments");
check("payments: list → 200", r.status === 200 && Array.isArray(r.json?.invoices), r.json);
const open = r.json?.invoices?.find((i) => i.outstanding > 1);
r = await owner("POST", "/api/payments", { invoiceId: "missing", amount: 10, mode: "upi", receivedAt: istToday() });
check("payment: unknown invoice → 400", r.status === 400 && r.json?.fieldErrors?.invoiceId, r.json);
r = await owner("POST", "/api/payments", { invoiceId: open?.id ?? "x", amount: 10, mode: "bitcoin", receivedAt: istToday() });
check("payment: unknown mode → 400", r.status === 400 && r.json?.fieldErrors?.mode, r.json);
if (open) {
  r = await owner("POST", "/api/payments", { invoiceId: open.id, amount: open.outstanding + 1, mode: "neft", receivedAt: istToday() });
  check("payment: more than outstanding → 400", r.status === 400 && r.json?.fieldErrors?.amount, r.json);
  r = await owner("POST", "/api/payments", { invoiceId: open.id, amount: 1, mode: "neft", receivedAt: istToday() });
  check("payment: valid → 201, outstanding drops by 1", r.status === 201 && Math.abs(r.json.outstanding - (open.outstanding - 1)) < 0.006, r.json);
  // Two payments for the full remaining balance at once: at most one may succeed.
  const rest = Math.round((open.outstanding - 1) * 100) / 100;
  const [a, b] = await Promise.all([
    owner("POST", "/api/payments", { invoiceId: open.id, amount: rest, mode: "rtgs", receivedAt: istToday() }),
    owner("POST", "/api/payments", { invoiceId: open.id, amount: rest, mode: "rtgs", receivedAt: istToday() }),
  ]);
  check("payment: concurrent double payment can't overpay", [a.status, b.status].filter((s) => s === 201).length === 1, [a, b]);
  r = await owner("POST", "/api/payments", { invoiceId: open.id, amount: 1, mode: "neft", receivedAt: istToday() });
  check("payment: fully paid invoice rejects more", r.status === 400 && r.json?.fieldErrors?.invoiceId, r.json);
} else {
  console.log("SKIP  payment balance checks (no invoice with an outstanding balance)");
}

// --- analytics -----------------------------------------------------------------
r = await owner("GET", "/api/analytics/cost-per-order");
check("cost-per-order → 200 with orders", r.status === 200 && Array.isArray(r.json?.orders), r.json);
const orders = r.json?.orders ?? [];
check(
  "cost-per-order: every total = sum of its lines, profit = revenue − cost",
  orders.every((o) => {
    const sum = Object.values(o.costs).reduce((s, n) => s + n, 0);
    return Math.abs(sum - o.totalCost) < 0.05 && Math.abs(o.revenue - o.totalCost - o.profit) < 0.05 && Math.abs(o.revenue - o.qtyMetres * o.pricePerMetre) < 0.05;
  }),
);
if (orders[0]) {
  r = await owner("GET", `/api/analytics/cost-per-order?orderId=${orders[0].orderId}`);
  check("cost-per-order: single order with roll costs", r.status === 200 && Array.isArray(r.json?.rolls), r.json);
}
r = await owner("GET", "/api/analytics/cost-per-order?month=2026-1");
check("cost-per-order: bad month → 400", r.status === 400, r.json);
r = await owner("GET", "/api/analytics/machine-output?days=0");
check("machine-output: days=0 → 400", r.status === 400, r.json);
r = await owner("GET", "/api/analytics/machine-output?days=7");
check("machine-output → 200", r.status === 200 && Array.isArray(r.json?.machines), r.json);

// --- alerts --------------------------------------------------------------------
r = await owner("GET", "/api/alerts?unread=1");
check("alerts → 200 with unreadCount", r.status === 200 && typeof r.json?.unreadCount === "number", r.json);
const firstUnread = r.json?.notifications?.[0];
r = await owner("PATCH", "/api/alerts", {});
check("alerts: PATCH without ids/all → 400", r.status === 400, r.json);
if (firstUnread) {
  r = await owner("PATCH", "/api/alerts", { ids: [firstUnread.id] });
  check("alerts: mark one read", r.status === 200 && r.json?.updated === 1, r.json);
  r = await owner("PATCH", "/api/alerts", { ids: [firstUnread.id], read: false });
  check("alerts: mark it unread again", r.status === 200 && r.json?.updated === 1, r.json);
}

// --- audit -----------------------------------------------------------------------
r = await owner("GET", `/api/audit?entity=Worker&q=${encodeURIComponent(wname)}`);
check("audit: worker create + update logged", r.status === 200 && r.json?.entries?.some((e) => e.action === "create") && r.json.entries.some((e) => e.action === "update"), r.json);
r = await owner("GET", "/api/audit?from=2026-10-10&to=2026-10-01");
check("audit: from after to → 400", r.status === 400, r.json);

// --- assistant -----------------------------------------------------------------
r = await owner("POST", "/api/assistant/query", { question: "" });
check("assistant: empty question → 400", r.status === 400 && r.json?.fieldErrors?.question, r.json);
r = await owner("POST", "/api/assistant/query", { question: "Which order made the least profit this month?" });
check("assistant: least-profit question runs profitByOrder", r.status === 200 && r.json?.tool === "profitByOrder" && typeof r.json?.answer === "string", r.json);

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
