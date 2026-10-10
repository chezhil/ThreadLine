"use client";
import { useEffect, useRef } from "react";
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
