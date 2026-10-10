"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IdCard, Menu, PanelLeftOpen } from "lucide-react";
import { LiveClock } from "./LiveClock";
import { BrandMark } from "./BrandMark";
import { displayName, useShell } from "./ShellProvider";
import type { Role } from "@/lib/auth";
import { ROLE_HOME } from "@/lib/role-home";
import { useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { NAV_GROUP_LABEL, ROLE_LABEL, navForRole, type NavItem } from "./nav-config";

export function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const { user, prefs, setPref } = useShell();
  const collapsed = prefs.sidebarCollapsed;
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
  const home = ROLE_HOME[role];
  const toggle = () => setPref("sidebarCollapsed", !collapsed);

  return (
    // The column stretches with the page; its contents stay pinned on screen.
    <aside
      className={`hidden shrink-0 select-none border-r border-border bg-white transition-[width] duration-200 ease-out md:block ${
        collapsed ? "w-[4.5rem]" : "w-64 xl:w-72"
      }`}
      data-collapsed={collapsed}
    >
      <div className="sticky top-0 flex h-screen flex-col">
        <div className={`border-b border-border ${collapsed ? "px-2 pb-3 pt-4" : "px-4 pb-3 pt-4"}`}>
          <div className={`flex ${collapsed ? "flex-col items-center gap-3" : "items-center gap-2"}`}>
            {/* Logo and name together are one link back to the home page. */}
            <Link
              href={home}
              aria-label="ThreadLine ERP — go to dashboard"
              title="Go to dashboard"
              className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-sm outline-offset-4"
            >
              <span className="shrink-0 [perspective:400px]">
                <BrandMark className="block h-8 w-8 transition-transform duration-700 ease-out [transform-style:preserve-3d] group-hover:[transform:rotateY(360deg)]" />
              </span>
              {!collapsed && (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-display text-[15px] font-semibold leading-5 tracking-tight text-foreground transition-colors group-hover:text-brand">
                    ThreadLine ERP
                  </span>
                  <span className="label-caps-sm truncate text-gray-500">Everest Textile Mills</span>
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={collapsed}
              title={`${collapsed ? "Expand" : "Collapse"} sidebar ( [ )`}
              className="shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-surface-container hover:text-foreground"
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" /> : <Menu className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />}
            </button>
          </div>
          {!collapsed && (
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
              <div className="flex min-w-0 items-center gap-1.5">
                <IdCard className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
                <span className="truncate text-xs font-semibold text-foreground">{displayName(user)}</span>
              </div>
              <span className="label-caps-sm shrink-0 bg-surface-container px-1.5 py-0.5 text-gray-600">{roleLabel.tag}</span>
            </div>
          )}
        </div>

        <nav className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden px-2 py-3" aria-label="Main">
          {groups.map(({ group, items: groupItems }, index) => (
            <div key={group} className="mb-4 last:mb-0">
              {collapsed ? (
                index > 0 && <div className="mx-2 mb-2 border-t border-border" aria-hidden="true" />
              ) : (
                <p className="label-caps-sm px-2.5 pb-1.5 text-gray-500">{NAV_GROUP_LABEL[group]}</p>
              )}
              <ul className="space-y-0.5">
                {groupItems.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} count={counts[item.href] ?? 0} collapsed={collapsed} />
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {!collapsed && (
          <div className="shrink-0 border-t border-border bg-surface-low px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="label-caps-sm text-gray-500">Mill Clock</span>
              <span className="label-caps-sm inline-flex items-center gap-1 bg-brand-soft px-1.5 py-0.5 text-brand">
                <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                Surat Unit 1
              </span>
            </div>
            <LiveClock className="mt-1 block text-sm font-semibold text-foreground" />
            <p className="mt-2 border-t border-border pt-2 text-xs text-gray-500">{roleLabel.title}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function NavLink({ item, pathname, count, collapsed }: { item: NavItem; pathname: string; count: number; collapsed: boolean }) {
  const section = `/${item.href.split("/").filter(Boolean)[0]}`;
  const active = pathname === item.href || pathname === section || pathname.startsWith(`${section}/`);
  const Icon = item.icon;
  const badge = count > 99 ? "99+" : count;
  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? `${item.label}${count > 0 ? `, ${count} new` : ""}` : undefined}
        title={collapsed ? item.label : undefined}
        className={`group relative flex items-center gap-2 border-l-2 px-2.5 py-2 text-[13px] transition-colors ${
          collapsed ? "justify-center" : "justify-between"
        } ${
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
          {!collapsed && <span className="truncate">{item.label}</span>}
        </span>
        {count > 0 &&
          (collapsed ? (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-600 ring-2 ring-white" aria-hidden="true" />
          ) : (
            <span
              className={`label-caps-sm min-w-5 px-1.5 py-0.5 text-center tabular-nums ${
                active ? "bg-white/20 text-white" : "border border-red-200 bg-red-50 text-red-800"
              }`}
            >
              {badge}
            </span>
          ))}
      </Link>
    </li>
  );
}
