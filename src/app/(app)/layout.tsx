import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomTabs } from "@/components/layout/BottomTabs";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { NotificationBell } from "@/components/alerts/NotificationBell";

// Every page behind this layout reads the session cookie and live DB rows —
// nothing here is safe to prerender/cache.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen w-full">
      <Sidebar role={user.role} userName={user.name} />
      <div className="flex flex-1 flex-col">
        <header className="flex min-h-12 items-center justify-between gap-2 border-b border-border bg-white px-4 py-2">
          <Breadcrumbs />
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 pb-20 md:pb-4">{children}</main>
        <BottomTabs role={user.role} />
      </div>
    </div>
  );
}
