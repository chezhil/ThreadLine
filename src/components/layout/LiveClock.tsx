"use client";
import { useEffect, useState } from "react";
import { useShellOptional } from "./ShellProvider";

function istNow(seconds: boolean, hour12: boolean) {
  return new Date().toLocaleTimeString(hour12 ? "en-US" : "en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: seconds ? "2-digit" : undefined,
    hour12,
  });
}

/** The mill's wall clock, in IST. Renders nothing until mounted so the
 * server and client never disagree about the time. */
export function LiveClock({ seconds = true, className = "" }: { seconds?: boolean; className?: string }) {
  const [time, setTime] = useState<string | null>(null);
  // The user's clock preferences (12/24 hour, seconds) apply wherever the
  // clock is shown inside the app shell.
  const prefs = useShellOptional()?.prefs;
  const hour12 = prefs?.timeFormat === "12h";
  const showSeconds = seconds && (prefs?.showSeconds ?? true);

  useEffect(() => {
    const tick = () => setTime(istNow(showSeconds, hour12));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [showSeconds, hour12]);

  return (
    <span className={`tabular-nums ${className}`} suppressHydrationWarning>
      {time ?? "--:--"} IST
    </span>
  );
}
