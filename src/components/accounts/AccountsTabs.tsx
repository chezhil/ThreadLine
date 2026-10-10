"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/accounts", label: "Month-end" },
  { href: "/accounts/costing", label: "Cost per order" },
  { href: "/accounts/payments", label: "Payments" },
  { href: "/accounts/expenses", label: "Expenses" },
  { href: "/accounts/attendance", label: "Attendance" },
  { href: "/accounts/workers", label: "Workers" },
];

export function AccountsTabs() {
  const pathname = usePathname();
  return (
    <nav className="-mx-4 overflow-x-auto border-b border-border px-4" aria-label="Accounts sections">
      <div className="flex gap-1">
        {TABS.map((t) => {
          const active = t.href === "/accounts" ? pathname === "/accounts" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors ${
                active ? "border-brand font-semibold text-brand" : "border-transparent font-medium text-gray-500 hover:border-gray-300 hover:text-foreground"
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
