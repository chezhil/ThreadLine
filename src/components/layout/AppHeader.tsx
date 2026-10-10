"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Command, Sparkles } from "lucide-react";
import type { Role } from "@/lib/auth";
import { useRealtimeConnected } from "@/lib/useRealtime";
import { NotificationBell } from "@/components/alerts/NotificationBell";
import { SyncStatus } from "@/components/quality/SyncStatus";
import { Breadcrumbs } from "./Breadcrumbs";
import { LiveClock } from "./LiveClock";
import { BrandMark } from "./BrandMark";
import { UserMenu } from "./UserMenu";
import { useShell } from "./ShellProvider";
import { navItemForPath } from "./nav-config";
import { ROLE_HOME } from "@/lib/role-home";

// Two bands, as in the Stitch shell: a white control bar (where am I, is the
// floor live, what time is it at the mill, who am I) and a quieter strip with
// the breadcrumb trail and the owner's shortcut to the assistant.
export function AppHeader({ role, userId }: { role: Role; userId: string }) {
  const pathname = usePathname();
  const { setPaletteOpen } = useShell();
  const section = navItemForPath(pathname);
  const title = pathname.startsWith("/profile") ? "Profile & Settings" : (section?.short ?? "ThreadLine");
  const live = useRealtimeConnected();

  return (
    <header className="sticky top-0 z-30">
      <div className="flex h-14 items-center justify-between gap-3 border-b border-border bg-white px-4">
        {/* The title gives way first: it truncates, and the unit label only
            appears where there is room, so it can never run under the controls. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          <Link href={ROLE_HOME[role]} aria-label="ThreadLine home" className="shrink-0 md:hidden">
            <BrandMark className="h-7 w-7" />
          </Link>
          <span className="label-caps hidden shrink-0 whitespace-nowrap text-gray-500 2xl:inline">Everest Unit-1</span>
          <span className="hidden shrink-0 text-border-strong 2xl:inline">/</span>
          <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2 xl:gap-3">
          <span
            className={`label-caps-sm hidden shrink-0 items-center gap-1.5 whitespace-nowrap border px-2 py-1 md:inline-flex ${
              live ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-border bg-surface-low text-gray-500"
            }`}
            title={live ? "Mill telemetry: live updates connected" : "Mill telemetry: live updates reconnecting"}
          >
            <span className="relative flex h-2 w-2">
              {live && <span className="absolute inline-flex h-full w-full animate-live-ping rounded-full bg-emerald-400 opacity-75" />}
              <span className={`relative inline-flex h-2 w-2 rounded-full ${live ? "bg-emerald-600" : "bg-gray-400"}`} />
            </span>
            {/* Just the dot until there's room for the words. */}
            <span className="hidden xl:inline">Mill telemetry: {live ? "Live" : "Offline"}</span>
            <span className="sr-only xl:hidden">Mill telemetry: {live ? "Live" : "Offline"}</span>
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap text-gray-500 lg:inline-flex">
            <Clock className="h-4 w-4" aria-hidden="true" />
            <LiveClock className="text-[13px] font-medium text-foreground" />
          </span>
          <span className="hidden h-4 w-px bg-border-strong lg:block" aria-hidden="true" />
          <SyncStatus canBackup={role === "owner"} userId={userId} />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command menu"
            title="Command menu (Ctrl K)"
            className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-border bg-surface-low p-1.5 text-xs text-gray-500 transition-colors hover:border-border-strong hover:text-foreground md:inline-flex 2xl:px-2.5"
          >
            <Command className="h-4 w-4 2xl:h-3.5 2xl:w-3.5" aria-hidden="true" />
            <span className="hidden 2xl:inline">Search or jump to…</span>
            <kbd className="hidden border border-border bg-white px-1 text-[10px] font-semibold 2xl:inline">Ctrl K</kbd>
          </button>
          <NotificationBell />
          <UserMenu />
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
