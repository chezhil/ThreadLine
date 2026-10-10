"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth";
import { MOBILE_TOP_ACTIONS } from "./nav-config";

export function BottomTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = MOBILE_TOP_ACTIONS[role] ?? [];

  return (
    <nav
      aria-label="Quick"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_12px_-6px_rgb(25_28_30/0.12)] backdrop-blur md:hidden"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
              active ? "text-brand" : "text-gray-500"
            }`}
          >
            {active && <span className="absolute inset-x-3 top-0 h-0.5 bg-brand" aria-hidden="true" />}
            <Icon className="h-5 w-5" strokeWidth={active ? 2.1 : 1.75} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
