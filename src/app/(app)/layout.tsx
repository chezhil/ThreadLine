import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/layout/Sidebar";
import { BottomTabs } from "@/components/layout/BottomTabs";
import { AppHeader } from "@/components/layout/AppHeader";

// Every page behind this layout reads the session cookie and live DB rows —
// nothing here is safe to prerender/cache.
export const instant = false;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar role={user.role} userName={user.name} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader role={user.role} userName={user.name} userId={user.id} />
        <main className="flex-1 p-4 pb-24 md:pb-6">{children}</main>
        <BottomTabs role={user.role} />
      </div>
    </div>
  );
}
