// Demo helper: keeps nudging real data through the real API so a screen
// showing the dashboard / floor board / QC queue / dispatch visibly updates
// live (via the socket.io push) without anyone touching a keyboard.
//
// Not a test — it's fine for this to occasionally skip an action because the
// mill state doesn't allow it right now (machine not running, shift capacity
// used up, etc.). It just tries something else next tick.
//
// Usage: npm run dev (one terminal), then in another:
//   npx tsx scripts/demo-live.ts
// Stop with Ctrl+C. Tune pace with DEMO_INTERVAL_MS (default 4000).

export {}; // isolate this script's scope (no imports otherwise, so `BASE`/`run` would collide with scripts/load-test.ts under tsc)

const BASE = process.env.BASE ?? "http://localhost:3000";
const INTERVAL_MS = Number(process.env.DEMO_INTERVAL_MS ?? 4000);

type Cookie = string;

async function login(name: string, password: string): Promise<Cookie> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  if (!res.ok) throw new Error(`Login as ${name} failed: HTTP ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`No session cookie for ${name}`);
  return cookie;
}

async function api(cookie: Cookie, method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON error page; leave json null
  }
  return { ok: res.ok, status: res.status, json };
}

function pick<T>(arr: T[]): T | undefined {
  return arr.length ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

function stamp(): string {
  return new Date().toLocaleTimeString("en-IN", { hour12: false });
}

function say(action: string, detail: string) {
  console.log(`[${stamp()}] ${action.padEnd(10)} ${detail}`);
}

function skip(action: string, why: string) {
  console.log(`[${stamp()}] ${action.padEnd(10)} (skipped — ${why})`);
}

// ---------------------------------------------------------------- actions --
// Each returns true if it actually changed something (so the caller knows
// whether a visible update went out).

async function logProduction(floor: Cookie): Promise<boolean> {
  const { ok, json } = await api(floor, "GET", "/api/work-orders");
  if (!ok) return false;
  const candidates = (json.workOrders as any[]).filter(
    (w) => w.status === "IN_PROGRESS" && w.machine.status === "RUNNING" && w.producedQty < w.plannedQty,
  );
  const wo = pick(candidates);
  if (!wo) {
    skip("production", "no running machine has an in-progress order with room left");
    return false;
  }
  const remaining = wo.plannedQty - wo.producedQty;
  const qty = Math.max(1, Math.round(Math.min(remaining, 15 + Math.random() * 45)));
  const shift = new Date().getHours() < 14 ? "Morning" : "Evening";
  const { ok: logged, json: result } = await api(floor, "POST", "/api/production-logs", {
    workOrderId: wo.id,
    shift,
    qtyProduced: qty,
  });
  if (logged) {
    say("production", `${wo.order.orderNo} on ${wo.machine.name} +${qty} m`);
    return true;
  }
  skip("production", result?.error ?? Object.values(result?.fieldErrors ?? {}).flat()[0] ?? `HTTP ${result?.status}`);
  return false;
}

async function toggleMachine(floor: Cookie): Promise<boolean> {
  const { ok, json } = await api(floor, "GET", "/api/machines");
  if (!ok) return false;
  const machine = pick(json.machines as any[]);
  if (!machine) return false;

  let next: string;
  if (machine.status === "BREAKDOWN" || machine.status === "MAINTENANCE") {
    next = "RUNNING"; // "repaired" — satisfying to watch recover live
  } else if (machine.status === "IDLE") {
    next = "RUNNING";
  } else {
    // RUNNING: usually idles for a beat, rarely trips a breakdown
    next = Math.random() < 0.1 ? "BREAKDOWN" : "IDLE";
  }
  if (next === machine.status) return false;

  const { ok: changed } = await api(floor, "PATCH", `/api/machines/${machine.id}/status`, { status: next });
  if (changed) {
    say("machine", `${machine.name} → ${next}`);
    return true;
  }
  return false;
}

const DEFECTS = ["hole", "colour_mismatch", "uneven_weave"];

async function inspectRoll(qc: Cookie): Promise<boolean> {
  const { ok, json } = await api(qc, "GET", "/api/rolls?qcStatus=PENDING");
  if (!ok) return false;
  const rolls: any[] = Array.isArray(json) ? json : (json?.rolls ?? []);
  const roll = pick(rolls);
  if (!roll) {
    skip("qc", "no pending rolls to inspect");
    return false;
  }
  const r = Math.random();
  const result = r < 0.82 ? "PASS" : r < 0.93 ? "REWORK" : "REJECT";
  const defects = result === "PASS" ? [] : [pick(DEFECTS)];
  const { ok: inspected, json: inspectResult } = await api(qc, "POST", `/api/rolls/${roll.id}/qc`, { result, defects });
  if (inspected) {
    say("qc", `${roll.rollNo} → ${result}`);
    return true;
  }
  skip("qc", inspectResult?.error ?? `HTTP ${inspectResult?.status}`);
  return false;
}

async function dispatchTruck(store: Cookie): Promise<boolean> {
  const { ok, json } = await api(store, "GET", "/api/rolls?qcStatus=PASS&dispatched=false");
  if (!ok) return false;
  const rolls: any[] = (Array.isArray(json) ? json : (json?.rolls ?? [])).filter((r: any) => r.order?.buyer?.id);
  if (rolls.length === 0) {
    skip("dispatch", "no undispatched PASS rolls");
    return false;
  }
  const buyerId = pick(rolls)!.order.buyer.id;
  const sameBuyer = rolls.filter((r) => r.order.buyer.id === buyerId);
  const count = Math.min(sameBuyer.length, 1 + Math.floor(Math.random() * 3));
  const take = sameBuyer.slice(0, count);
  const truckNo = `DEMO-${Math.floor(1000 + Math.random() * 9000)}`;
  const { ok: dispatched, json: result } = await api(store, "POST", "/api/dispatches", {
    buyerId,
    truckNo,
    rollIds: take.map((r) => r.id),
  });
  if (dispatched) {
    say("dispatch", `${take.length} roll(s) for ${take[0].order.buyer.name} → truck ${truckNo}`);
    return true;
  }
  skip("dispatch", result?.error ?? Object.values(result?.fieldErrors ?? {}).flat()[0] ?? `HTTP ${result?.status}`);
  return false;
}

// -------------------------------------------------------------------- run --

async function run() {
  console.log(`=== Demo live-update generator against ${BASE} (every ~${INTERVAL_MS}ms) ===`);
  console.log("Open the dashboard / floor board / QC queue / dispatch in a browser and watch it move. Ctrl+C to stop.\n");

  const [floor, qc, store] = await Promise.all([
    login("floor", "floor123"),
    login("qc", "qc123"),
    login("storekeeper", "store123"),
  ]);

  // Weighted so the floor stays the busiest, dispatch the rarest (it's the
  // most visually dramatic change, best saved for occasional punctuation).
  const actions: { weight: number; run: () => Promise<boolean> }[] = [
    { weight: 5, run: () => logProduction(floor) },
    { weight: 2, run: () => toggleMachine(floor) },
    { weight: 3, run: () => inspectRoll(qc) },
    { weight: 1, run: () => dispatchTruck(store) },
  ];
  const totalWeight = actions.reduce((s, a) => s + a.weight, 0);

  let running = true;
  process.on("SIGINT", () => {
    running = false;
  });

  let ticks = 0;
  let changes = 0;
  while (running) {
    let roll = Math.random() * totalWeight;
    const action = actions.find((a) => (roll -= a.weight) < 0) ?? actions[0];
    ticks++;
    try {
      if (await action.run()) changes++;
    } catch (err) {
      console.error(`[${stamp()}] error: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * (0.6 + Math.random() * 0.8)));
  }

  console.log(`\nStopped. ${changes}/${ticks} ticks produced a visible change.`);
}

run().catch((err) => {
  console.error("Demo generator crashed:", err);
  process.exit(1);
});
