"use client";
import { useEffect, useRef, useState } from "react";

/** True for a beat after `trigger` changes (never on first render) — pair
 * with the `animate-flash-update` utility so a tile visibly pulses when a
 * realtime push updates it, not just when the page first loads. Bump
 * `trigger` (e.g. a counter) from inside the realtime event handler that
 * causes the refetch. */
export function useFlash(trigger: unknown): boolean {
  const [active, setActive] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setActive(true);
    const timer = setTimeout(() => setActive(false), 1100);
    return () => clearTimeout(timer);
  }, [trigger]);

  return active;
}
