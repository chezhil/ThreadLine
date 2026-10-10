"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { navItemForPath } from "./nav-config";

function titleCase(segment: string) {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Record ids (cuids, uuids) read as "Details" rather than a wall of letters.
function looksLikeId(segment: string) {
  return segment.length >= 16 && /\d/.test(segment);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  const section = navItemForPath(pathname);

  const crumbs = segments.map((segment, i) => ({
    label: i === 0 && section ? section.short : looksLikeId(segment) ? "Details" : titleCase(segment),
    href: `/${segments.slice(0, i + 1).join("/")}`,
    isLast: i === segments.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-gray-500">
      <span className="hidden whitespace-nowrap sm:inline">Everest Mills</span>
      {crumbs.map((crumb, i) => (
        <span key={crumb.href} className="flex min-w-0 items-center gap-1.5">
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-gray-300 ${i === 0 ? "hidden sm:block" : ""}`} aria-hidden="true" />
          {crumb.isLast ? (
            <span className="truncate font-semibold text-brand" aria-current="page">
              {crumb.label}
            </span>
          ) : (
            <Link href={crumb.href} className="truncate transition-colors hover:text-foreground">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
