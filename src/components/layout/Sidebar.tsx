"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@/lib/auth";
import { navForRole } from "./nav-config";

export function Sidebar({ role, userName }: { role: Role; userName: string }) {
  const pathname = usePathname();
  const items = navForRole(role);

  return (
    <aside className="hidden w-56 flex-col border-r border-border bg-white md:flex">
      <div className="border-b border-border px-4 py-4">
        <p className="text-sm font-semibold text-foreground">ThreadLine</p>
        <p className="text-xs text-gray-500">Everest Textile Mills</p>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm font-medium ${
                active ? "bg-brand/10 text-brand" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <div className="mb-2 text-xs text-gray-500">
          Signed in as <span className="font-medium text-foreground">{userName}</span>
        </div>
        <LogoutButton />
      </div>
    </aside>
  );
}

function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        // The offline service worker keeps copies of pages and roll lists; don't
        // leave them for whoever signs in next on this device.
        if ("caches" in window) {
          const keys = await caches.keys().catch(() => [] as string[]);
          await Promise.all(keys.filter((k) => k.startsWith("threadline-")).map((k) => caches.delete(k)));
        }
        router.push("/login");
        router.refresh();
      }}
      className="w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
    >
      Sign out
    </button>
  );
}
