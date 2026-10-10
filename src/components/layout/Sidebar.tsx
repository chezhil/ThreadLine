"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IdCard, LogOut } from "lucide-react";
import { LogoutButton } from "./LogoutButton";
import { LiveClock } from "./LiveClock";
import { BrandMark } from "./BrandMark";
import type { Role } from "@/lib/auth";
import { useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { NAV_GROUP_LABEL, ROLE_LABEL, navForRole, type NavItem } from "./nav-config";

export function Sidebar({ role, userName }: { role: Role; userName: string }) {
  const pathname = usePathname();
  const items = navForRole(role);
  const alerts = useApi<{ unreadCount: number }>("/api/alerts?unread=1&limit=1");
  const approvals = useApi<{ total: number }>(role === "owner" ? "/api/approvals/pending" : null);
  useRealtimeEvent(RealtimeEvents.NotificationNew, () => {
    alerts.refetch();
    if (role === "owner") approvals.refetch();
  });

  const counts: Record<string, number> = {
    "/alerts": alerts.data?.unreadCount ?? 0,
    "/approvals": approvals.data?.total ?? 0,
  };
  const groups = (["mill", "control"] as const)
    .map((g) => ({ group: g, items: items.filter((i) => i.group === g) }))
    .filter((g) => g.items.length > 0);
  const roleLabel = ROLE_LABEL[role];

  return (
    // The column stretches with the page; its contents stay pinned on screen.
    <aside className="hidden w-64 shrink-0 select-none border-r border-border bg-white md:block xl:w-72">
      <div className="sticky top-0 flex h-screen flex-col">
        <div className="border-b border-border px-4 pb-3 pt-4">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-display text-[15px] font-semibold leading-5 tracking-tight text-foreground">ThreadLine ERP</span>
              <span className="label-caps-sm truncate text-gray-500">Everest Textile Mills</span>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <IdCard className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
              <span className="truncate text-xs font-semibold text-foreground">{userName}</span>
            </div>
            <span className="label-caps-sm shrink-0 bg-surface-container px-1.5 py-0.5 text-gray-600">{roleLabel.tag}</span>
          </div>
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3" aria-label="Main">
          {groups.map(({ group, items: groupItems }) => (
            <div key={group} className="mb-4 last:mb-0">
              <p className="label-caps-sm px-2.5 pb-1.5 text-gray-500">{NAV_GROUP_LABEL[group]}</p>
              <ul className="space-y-0.5">
                {groupItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} count={counts[item.href] ?? 0} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border bg-surface-low px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="label-caps-sm text-gray-500">Mill Clock</span>
            <span className="label-caps-sm inline-flex items-center gap-1 bg-brand-soft px-1.5 py-0.5 text-brand">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Surat Unit 1
            </span>
          </div>
          <LiveClock className="mt-1 block text-sm font-semibold text-foreground" />
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
            <span className="text-xs text-gray-500">{roleLabel.title}</span>
            <LogoutButton className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 transition-colors hover:text-red-700">
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              Sign out
            </LogoutButton>
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavLink({ item, pathname, count }: { item: NavItem; pathname: string; count: number }) {
  const section = `/${item.href.split("/").filter(Boolean)[0]}`;
  const active = pathname === item.href || pathname === section || pathname.startsWith(`${section}/`);
  const Icon = item.icon;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`group flex items-center justify-between gap-2 border-l-2 px-2.5 py-2 text-[13px] transition-colors ${
          active
            ? "border-brand bg-brand-container font-semibold text-white shadow-sm"
            : "border-transparent text-gray-600 hover:bg-surface-container hover:text-foreground"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon
            className={`h-[18px] w-[18px] shrink-0 ${active ? "text-white" : "text-gray-500 group-hover:text-foreground"}`}
            strokeWidth={1.75}
            aria-hidden="true"
          />
          <span className="truncate">{item.label}</span>
        </span>
        {count > 0 && (
          <span
            className={`label-caps-sm min-w-5 px-1.5 py-0.5 text-center tabular-nums ${
              active ? "bg-white/20 text-white" : "border border-red-200 bg-red-50 text-red-800"
            }`}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </li>
  );
}
