"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth";
import { MOBILE_TOP_ACTIONS } from "./nav-config";

export function BottomTabs({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = MOBILE_TOP_ACTIONS[role] ?? [];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-white md:hidden">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex-1 py-2 text-center text-xs font-medium ${
              active ? "text-brand" : "text-gray-500"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
