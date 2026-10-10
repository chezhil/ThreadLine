"use client";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { disconnectRealtime } from "@/lib/useRealtime";

export function LogoutButton({ className, children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        // Clear local copies even if the server can't be reached: the offline
        // service worker keeps copies of pages and roll lists, and they must
        // not be left for whoever signs in next on this device.
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        disconnectRealtime();
        if ("caches" in window) {
          const keys = await caches.keys().catch(() => [] as string[]);
          await Promise.all(keys.filter((k) => k.startsWith("threadline-")).map((k) => caches.delete(k)));
        }
        router.push("/login");
        router.refresh();
      }}
      className={
        className ??
        "w-full rounded-md border border-border px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100"
      }
    >
      {children ?? "Sign out"}
    </button>
  );
}
