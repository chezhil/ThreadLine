import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomTabs } from "@/components/layout/BottomTabs";
import { AppHeader } from "@/components/layout/AppHeader";
import { PageTransition } from "@/components/layout/PageTransition";
import { ShellFrame } from "@/components/layout/ShellFrame";
import { ShellOverlays } from "@/components/layout/ShellOverlays";
import { ShellProvider } from "@/components/layout/ShellProvider";

// Every page behind this layout reads the session cookie and live DB rows —
// nothing here is safe to prerender/cache.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const { preferences, ...user } = profile;

  return (
    <ShellProvider initialUser={user} initialPrefs={preferences}>
      <ShellFrame>
        <Sidebar role={user.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* File backup/restore only exists for the SQLite layout; Postgres uses the provider's tooling. */}
          <AppHeader role={user.role} userId={user.id} fileBackups={!!process.env.DATABASE_URL?.startsWith("file:")} />
          <PageTransition className="flex-1 p-4 pb-24 md:pb-6">{children}</PageTransition>
          <BottomTabs role={user.role} />
        </div>
        <ShellOverlays role={user.role} />
      </ShellFrame>
    </ShellProvider>
  );
}
