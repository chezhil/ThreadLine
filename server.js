/* eslint-disable @typescript-eslint/no-require-imports */
// Custom server so Socket.io can share the same HTTP server as Next.js.
// Shared infra — see src/lib/realtime.ts for the emit helpers that use it.
// Plain CJS on purpose: this is the Node entrypoint itself, run directly by
// `node server.js` before any bundler is involved.
const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { createHash } = require("crypto");
const { PrismaClient } = require("@prisma/client");

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

// Turbopack in development on every platform (Next 16's default bundler).
const app = next({ dev, turbopack: dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, { path: "/api/socketio" });
  globalThis.__threadlineIO = io;

  // Only signed-in users receive realtime events (orders, rolls, stock and
  // payment notices): the handshake must carry a live session cookie, checked
  // the same way as src/lib/auth.ts (sha256 of the token in Session).
  const sessionDb = new PrismaClient();
  globalThis.__threadlineSocketDb = sessionDb; // the restore route reconnects it
  io.use(async (socket, nextMiddleware) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, "threadline_session");
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return nextMiddleware(new Error("unauthorized"));
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const session = await sessionDb.session.findUnique({ where: { tokenHash } });
      if (!session || session.expiresAt <= new Date()) return nextMiddleware(new Error("unauthorized"));
      socket.data.userId = session.userId;
      nextMiddleware();
    } catch (err) {
      console.error("[realtime] handshake check failed:", err);
      nextMiddleware(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("disconnect", () => {});
  });

  httpServer.listen(port, () => {
    console.log(`> ThreadLine ready on http://localhost:${port}`);
    startOutboxDrain();
  });
});

// Drains the buyer-alert outbox (queued WhatsApp messages and their retries)
// from inside this process, so a single-service deploy needs no separate
// `npm run alerts:worker`. Off unless ALERT_WORKER_TOKEN is set; the route
// claims rows conditionally, so several instances doing this never double-send.
function startOutboxDrain() {
  const token = process.env.ALERT_WORKER_TOKEN;
  if (!token || process.env.ALERT_AUTODRAIN === "0") return;
  const every = Math.max(5000, Number(process.env.ALERT_WORKER_INTERVAL_MS ?? 15000));
  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/alerts/outbox/process`, { method: "POST", headers: { "x-worker-token": token } });
      if (!res.ok) console.error(`[alerts] outbox drain got HTTP ${res.status}`);
      else {
        const r = await res.json();
        if (r.processed > 0) console.log(`[alerts] outbox: processed=${r.processed} sent=${r.sent} retried=${r.retried} failed=${r.failed}`);
      }
    } catch (err) {
      console.error("[alerts] outbox drain failed:", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }, every).unref();
  console.log(`> Alert outbox drains every ${every / 1000}s`);
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
