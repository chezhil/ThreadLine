"use client";
import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { RealtimeEvent } from "./realtime";

let socket: Socket | undefined;

function getSocket(): Socket {
  if (!socket) {
    socket = io({ path: "/api/socketio" });
  }
  return socket;
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
