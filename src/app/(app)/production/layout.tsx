import { EmptyState } from "@/components/ui";
import { ProductionTabs } from "@/components/production/ProductionTabs";
import { requireRole } from "@/lib/auth";

// Reads the session to gate the production screens — never prerender.
export const instant = false;

export default async function ProductionLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("owner", "floor_supervisor");
  if (!user) {
    return <EmptyState title="Production access only" description="Sign in as the owner or a floor supervisor to manage machines and work orders." />;
  }
  return (
    <div className="flex flex-col gap-4">
      <ProductionTabs />
      {children}
    </div>
  );
}
