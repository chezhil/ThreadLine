"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/production/floor-board", label: "Floor board" },
  { href: "/production/work-orders", label: "Work orders" },
  { href: "/production/machines", label: "Machines" },
];

export function ProductionTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-4 overflow-x-auto border-b border-border px-4" aria-label="Production sections">
      <div className="flex gap-1">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                active ? "border-brand text-brand" : "border-transparent text-gray-500 hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
