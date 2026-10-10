/* eslint-disable @typescript-eslint/no-require-imports */
// Custom server so Socket.io can share the same HTTP server as Next.js.
// Shared infra — see src/lib/realtime.ts for the emit helpers that use it.
// Plain CJS on purpose: this is the Node entrypoint itself, run directly by
// `node server.js` before any bundler is involved.
const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");

const dev = process.env.NODE_ENV !== "production";
const port = process.env.PORT ? Number(process.env.PORT) : 3000;

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer((req, res) => handle(req, res));

  const io = new Server(httpServer, { path: "/api/socketio" });
  globalThis.__threadlineIO = io;

  io.on("connection", (socket) => {
    socket.on("disconnect", () => {});
  });

  httpServer.listen(port, () => {
    console.log(`> ThreadLine ready on http://localhost:${port}`);
  });
});
