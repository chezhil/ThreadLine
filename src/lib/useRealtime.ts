"use client";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { RealtimeEvent } from "./realtime";

let socket: Socket | undefined;

function getSocket(): Socket {
  // The server refuses a handshake without a session and socket.io doesn't
  // retry a refused one, so a socket that gave up is replaced (e.g. after
  // signing in again in the same tab).
  if (!socket || (!socket.connected && !socket.active)) {
    socket?.removeAllListeners();
    socket = io({ path: "/api/socketio" });
  }
  return socket;
}

/** Close the realtime connection (on sign-out), so the next user's session
 * opens its own. */
export function disconnectRealtime() {
  socket?.disconnect();
  socket = undefined;
}

export function useRealtimeEvent<T = unknown>(
  event: RealtimeEvent,
  handler: (payload: T) => void,
) {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const s = getSocket();
    const listener = (payload: T) => handlerRef.current(payload);
    s.on(event, listener);
    return () => {
      s.off(event, listener);
    };
  }, [event]);
}

/** Whether the live event socket is connected right now — drives the
 * header's "Live" telemetry chip. */
export function useRealtimeConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = getSocket();
    const up = () => setConnected(true);
    const down = () => setConnected(false);
    s.on("connect", up);
    s.on("disconnect", down);
    s.on("connect_error", down);
    // Sync with a socket that connected before this component mounted.
    queueMicrotask(() => setConnected(s.connected));
    return () => {
      s.off("connect", up);
      s.off("disconnect", down);
      s.off("connect_error", down);
    };
  }, []);

  return connected;
}
