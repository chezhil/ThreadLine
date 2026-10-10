// Shared server-side realtime emitter. Everyone emits through here — don't open
// your own socket.io server. The io instance is attached to globalThis by server.js.
import type { Server } from "socket.io";

declare global {
  var __threadlineIO: Server | undefined;
}

export const RealtimeEvents = {
  MachineStatus: "machine:status",
  OrderStatus: "order:status",
  StockChanged: "stock:changed",
  NotificationNew: "notification:new",
  // Module 3 (quality/dispatch)
  RollCreated: "roll:created",
  QcCompleted: "qc:completed",
  DispatchCompleted: "dispatch:completed",
} as const;

export type RealtimeEvent = (typeof RealtimeEvents)[keyof typeof RealtimeEvents];

export function emit(event: RealtimeEvent, payload: unknown) {
  const io = globalThis.__threadlineIO;
  if (!io) {
    console.warn(`[realtime] no socket.io instance yet, dropped "${event}"`);
    return;
  }
  io.emit(event, payload);
}
