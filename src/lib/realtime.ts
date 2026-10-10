// Shared Realtime Emitter and Hook helpers

export type RealtimeEvent =
  | "machine:status"
  | "order:status"
  | "stock:changed"
  | "notification:new"
  | "roll:created"
  | "qc:completed"
  | "dispatch:completed";

/**
 * Server-side event emitter
 * When a socket server instance is attached to global, emit to it.
 * Otherwise fallback silently (e.g. during offline or local dev fallback).
 */
export function emitRealtime(event: RealtimeEvent, data: any) {
  try {
    const io = (globalThis as any).io;
    if (io) {
      io.emit(event, data);
    }
  } catch (err) {
    console.warn("Realtime emission failed:", err);
  }
}
