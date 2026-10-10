"use client";
import { useEffect, useState } from "react";

function istNow(seconds: boolean) {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12: false,
  });
}

/** The mill's wall clock, in IST. Renders nothing until mounted so the
 * server and client never disagree about the time. */
export function LiveClock({ seconds = true, className = "" }: { seconds?: boolean; className?: string }) {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setTime(istNow(seconds));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [seconds]);

  return (
    <span className={`tabular-nums ${className}`} suppressHydrationWarning>
      {time ?? "--:--"} IST
    </span>
  );
}
