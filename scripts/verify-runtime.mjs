// Production runtime smoke check: signed-in page shells and the shared socket.
// Run after build/seed with the custom server listening at BASE.
import { io } from "socket.io-client";

const BASE = process.env.BASE ?? "http://localhost:3000";
const pages = [
  "/dashboard",
  "/orders",
  "/inventory",
  "/production/machines",
  "/production/work-orders",
  "/production/floor-board",
  "/quality/qc",
  "/quality/rolls",
  "/quality/defects",
  "/dispatch",
  "/accounts",
  "/alerts",
  "/audit",
  "/assistant",
];

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "owner", password: "owner123" }),
  signal: AbortSignal.timeout(15000),
});
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (login.status !== 200 || !cookie) throw new Error(`Login failed: ${login.status}`);

for (const page of pages) {
  const response = await fetch(`${BASE}${page}`, {
    headers: { cookie },
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const ok = response.status === 200 && response.headers.get("content-type")?.includes("text/html");
  console.log(`${ok ? "PASS" : "FAIL"}  ${page}: ${response.status}`);
  if (!ok) process.exitCode = 1;
  await response.arrayBuffer();
}

const socket = io(BASE, { path: "/api/socketio", forceNew: true, timeout: 5000 });
try {
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  console.log("PASS  Socket.IO connection");
} catch (error) {
  console.error("FAIL  Socket.IO connection", error);
  process.exitCode = 1;
} finally {
  socket.disconnect();
}
