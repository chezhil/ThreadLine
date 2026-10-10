"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, LogOut, Sparkles } from "lucide-react";
import type { Role } from "@/lib/auth";
import { useRealtimeConnected } from "@/lib/useRealtime";
import { NotificationBell } from "@/components/alerts/NotificationBell";
import { SyncStatus } from "@/components/quality/SyncStatus";
import { Breadcrumbs } from "./Breadcrumbs";
import { LiveClock } from "./LiveClock";
import { LogoutButton } from "./LogoutButton";
import { BrandMark } from "./BrandMark";
import { ROLE_LABEL, initials, navItemForPath } from "./nav-config";

// Two bands, as in the Stitch shell: a white control bar (where am I, is the
// floor live, what time is it at the mill, who am I) and a quieter strip with
// the breadcrumb trail and the owner's shortcut to the assistant.
export function AppHeader({ role, userName, userId }: { role: Role; userName: string; userId: string }) {
  const pathname = usePathname();
  const section = navItemForPath(pathname);
  const live = useRealtimeConnected();

  return (
    <header className="sticky top-0 z-30">
      <div className="flex h-14 items-center justify-between gap-3 border-b border-border bg-white px-4">
        <div className="flex min-w-0 items-center gap-2">
          <BrandMark className="h-7 w-7 shrink-0 md:hidden" />
          <span className="label-caps hidden text-gray-500 sm:inline">Everest Unit-1</span>
          <span className="hidden text-border-strong sm:inline">/</span>
          <span className="truncate text-[13px] font-medium text-foreground">{section?.short ?? "ThreadLine"}</span>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <span
            className={`label-caps-sm hidden items-center gap-1.5 border px-2 py-1 lg:inline-flex ${
              live ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-surface-low text-gray-500"
            }`}
            title={live ? "Live updates connected" : "Live updates reconnecting"}
          >
            <span className="relative flex h-2 w-2">
              {live && <span className="absolute inline-flex h-full w-full animate-live-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-600" : "bg-gray-400"}`} />
            </span>
            Mill telemetry: {live ? "Live" : "Offline"}
          </span>
          <span className="hidden items-center gap-1.5 text-gray-500 md:inline-flex">
            <Clock className="h-4 w-4" aria-hidden="true" />
            <LiveClock className="text-[13px] font-medium text-foreground" />
          </span>
          <span className="hidden h-4 w-px bg-border-strong md:block" aria-hidden="true" />
          <SyncStatus canBackup={role === "owner"} userId={userId} />
          <NotificationBell />
          <div className="flex items-center gap-2 pl-1">
            <div className="hidden flex-col text-right leading-tight sm:flex">
              <span className="text-xs font-semibold text-foreground">{userName}</span>
              <span className="label-caps-sm text-gray-500">{ROLE_LABEL[role].title}</span>
            </div>
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full border border-brand/20 bg-brand-soft font-display text-xs font-semibold text-brand"
              aria-hidden="true"
            >
              {initials(userName)}
            </span>
            {/* The sidebar (with its sign-out) is hidden on phones. */}
            <LogoutButton className="p-1.5 text-gray-500 hover:text-red-700 md:hidden">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Sign out</span>
            </LogoutButton>
          </div>
        </div>
      </div>

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-white/90 px-4 py-1.5 shadow-xs backdrop-blur">
        <Breadcrumbs />
        {role === "owner" && pathname !== "/assistant" && (
          <Link
            href="/assistant"
            className="inline-flex items-center gap-1.5 bg-brand px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-brand-container active:scale-[0.99]"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Ask Assistant
          </Link>
        )}
      </div>
    </header>
  );
}
