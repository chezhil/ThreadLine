import type { useRouter } from "next/navigation";
import { disconnectRealtime } from "@/lib/useRealtime";

/** Ends the session and clears everything this device kept for it. */
export async function signOut(router: ReturnType<typeof useRouter>) {
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
}
