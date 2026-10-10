import { EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/auth";

// Reads the session to gate the dispatch screen — never prerender.
export const instant = false;

export default async function DispatchLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) {
    return <EmptyState title="Dispatch access only" description="Sign in as the owner or the storekeeper to load trucks." />;
  }
  return <>{children}</>;
}
