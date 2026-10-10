"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Tab strip for a section's sub-pages (same look as the Accounts tabs). The
// active tab is the most specific one the path is under, so /orders/buyers
// is "Buyers" while /orders/<id> stays under "Orders".
export function SectionTabs({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  const activeHref = tabs
    .map((t) => t.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  return (
    <nav className="-mx-4 overflow-x-auto border-b border-border px-4" aria-label={label}>
      <div className="flex gap-1">
        {tabs.map((t) => {
          const active = t.href === activeHref;
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
