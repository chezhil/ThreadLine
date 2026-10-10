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
        <div className="flex min-w-0 items-center gap-2">
          <Link href={ROLE_HOME[role]} aria-label="ThreadLine home" className="shrink-0 md:hidden">
            <BrandMark className="h-7 w-7" />
          </Link>
          <span className="label-caps hidden text-gray-500 sm:inline">Everest Unit-1</span>
          <span className="hidden text-border-strong sm:inline">/</span>
          <span className="truncate text-[13px] font-medium text-foreground">{title}</span>
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
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command menu"
            title="Command menu (Ctrl K)"
            className="hidden items-center gap-2 rounded-md border border-border bg-surface-low px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-border-strong hover:text-foreground lg:inline-flex"
          >
            <Command className="h-3.5 w-3.5" aria-hidden="true" />
            Search or jump to…
            <kbd className="border border-border bg-white px-1 text-[10px] font-semibold">Ctrl K</kbd>
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
