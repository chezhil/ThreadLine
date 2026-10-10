// Readiness checklist item 8 (HARDENING_ADDENDUM.md): "a quick load test —
// not a performance target, just a sanity check that nothing falls over
// under concurrent reads the way item 1's bugs were concurrent write
// failures." Plain fetch, no autocannon dependency — fires CONCURRENCY
// requests at a few read-heavy endpoints for DURATION_MS and reports
// success/error counts and latency percentiles.
//
// Usage: npm run dev (one terminal), then in another:
//   BASE=http://localhost:3000 npx tsx scripts/load-test.ts

const BASE = process.env.BASE ?? "http://localhost:3000";
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 20);
const DURATION_MS = Number(process.env.LOAD_DURATION_MS ?? 10_000);

const ENDPOINTS = [
  "/api/orders",
  "/api/analytics/cost-per-order",
  "/api/analytics/machine-output?days=7",
  "/api/alerts?unread=1&limit=10",
];

async function loginOwner(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "owner", password: "owner123" }),
  });
  if (!res.ok) throw new Error(`Owner login failed: HTTP ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No session cookie returned");
  return cookie;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function worker(cookie: string, latencies: number[], errors: { count: number }, deadline: number) {
  let i = 0;
  while (Date.now() < deadline) {
    const path = ENDPOINTS[i % ENDPOINTS.length];
    i++;
    const start = Date.now();
    try {
      const res = await fetch(`${BASE}${path}`, { headers: { cookie } });
      latencies.push(Date.now() - start);
      if (!res.ok) errors.count++;
      await res.arrayBuffer(); // drain the body
    } catch {
      latencies.push(Date.now() - start);
      errors.count++;
    }
  }
}

async function run() {
  console.log(`=== Load test: ${CONCURRENCY} concurrent workers for ${DURATION_MS / 1000}s against ${BASE} ===`);
  console.log(`Endpoints: ${ENDPOINTS.join(", ")}`);

  const cookie = await loginOwner();
  const latencies: number[] = [];
  const errors = { count: 0 };
  const deadline = Date.now() + DURATION_MS;

  const started = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(cookie, latencies, errors, deadline)));
  const elapsedSec = (Date.now() - started) / 1000;

  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.length;
  const rps = total / elapsedSec;

  console.log("\n=== Results ===");
  console.log(`Total requests : ${total}`);
  console.log(`Errors         : ${errors.count} (${total > 0 ? ((errors.count / total) * 100).toFixed(2) : "0"}%)`);
  console.log(`Requests/sec   : ${rps.toFixed(1)}`);
  console.log(`Latency p50    : ${percentile(sorted, 50)}ms`);
  console.log(`Latency p95    : ${percentile(sorted, 95)}ms`);
  console.log(`Latency p99    : ${percentile(sorted, 99)}ms`);
  console.log(`Latency max    : ${sorted[sorted.length - 1] ?? 0}ms`);

  if (errors.count > 0) {
    console.error(`\nFAIL: ${errors.count} request(s) errored under concurrent load.`);
    process.exit(1);
  }
  console.log("\nPASS: no errors under concurrent read load.");
}

run().catch((err) => {
  console.error("Load test crashed:", err);
  process.exit(1);
});
