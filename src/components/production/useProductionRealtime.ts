"use client";

import { RealtimeEvents } from "@/lib/realtime";
import { useRealtimeEvent } from "@/lib/useRealtime";

// Listens on the foundation's shared Socket.io client (path /api/socketio).
export function useProductionRealtime(onChange: () => void) {
  useRealtimeEvent(RealtimeEvents.MachineStatus, onChange);
  useRealtimeEvent(RealtimeEvents.OrderStatus, onChange);
  useRealtimeEvent(RealtimeEvents.NotificationNew, onChange);
}
