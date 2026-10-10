import { EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/auth";

// Reads the session to gate the inventory screen — never prerender.
export const instant = false;

export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) {
    return <EmptyState title="Inventory access only" description="Sign in as the owner or the storekeeper to manage yarn stock." />;
  }
  return <>{children}</>;
}
