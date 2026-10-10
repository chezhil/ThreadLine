"use client";

import { useEffect } from "react";
import { io } from "socket.io-client";

// This is the client-side listener for the foundation's Socket.io server.
export function useProductionRealtime(onChange: () => void) {
  useEffect(() => {
    const socket = io();
    socket.on("machine:status", onChange);
    socket.on("order:status", onChange);
    socket.on("notification:new", onChange);
    return () => {
      socket.off("machine:status", onChange);
      socket.off("order:status", onChange);
      socket.off("notification:new", onChange);
      socket.disconnect();
    };
  }, [onChange]);
}
