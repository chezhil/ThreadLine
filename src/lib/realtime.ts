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
  // A record was edited, archived, deleted or reversed (payload: DataChange).
  DataChanged: "data:changed",
} as const;

export type RealtimeEvent = (typeof RealtimeEvents)[keyof typeof RealtimeEvents];

/** Ids only — what changed, never the data itself. */
export interface DataChange {
  entity: string;
  id: string;
  action: "update" | "delete" | "archive" | "restore" | "reverse";
}

export function emitDataChanged(change: DataChange) {
  emit(RealtimeEvents.DataChanged, change);
}

export function emit(event: RealtimeEvent, payload: unknown) {
  const io = globalThis.__threadlineIO;
  if (!io) {
    console.warn(`[realtime] no socket.io instance yet, dropped "${event}"`);
    return;
  }
  io.emit(event, payload);
}
