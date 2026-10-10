"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { postJson, useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { statusBadgeClass } from "@/lib/tokens";
import { alertKindLabel, formatAlertTime, severityStatus, type NotificationRow } from "@/lib/accounts/alert-format";

// Header bell: unread count, live via the shared notification:new event, and
// a dropdown of the latest unread alerts.
export function NotificationBell() {
  const { data, refetch } = useApi<{ notifications: NotificationRow[]; unreadCount: number }>("/api/alerts?unread=1&limit=6");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useRealtimeEvent(RealtimeEvents.NotificationNew, () => refetch());

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = data?.unreadCount ?? 0;

  async function markAllRead() {
    await postJson("/api/alerts", { all: true }, "PATCH");
    refetch();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${count ? `, ${count} unread` : ""}`}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-gray-600 transition-colors hover:bg-surface-container hover:text-foreground"
      >
        <Bell className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-sm bg-red-700 px-1 text-center text-[10px] font-bold leading-4 text-white ring-2 ring-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-border bg-surface-low px-3 py-2">
            <span className="label-caps text-gray-600">Mill alerts</span>
            {count > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-brand hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {(data?.notifications ?? []).length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">You&apos;re all caught up.</li>}
            {(data?.notifications ?? []).map((n) => (
              <li key={n.id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(severityStatus(n.severity))}`}>
                    {alertKindLabel(n.type)}
                  </span>
                  <span className="text-[11px] text-gray-400">{formatAlertTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-gray-700">{n.message}</p>
              </li>
            ))}
          </ul>
          <Link href="/alerts" onClick={() => setOpen(false)} className="block border-t border-border px-3 py-2 text-center text-xs font-semibold text-brand hover:bg-surface-low">
            Open notification centre
          </Link>
        </div>
      )}
    </div>
  );
}
