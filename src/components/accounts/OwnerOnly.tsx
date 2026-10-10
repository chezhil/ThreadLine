import { EmptyState } from "@/components/ui";
import { requireRole } from "@/lib/auth";

// Server-side page guard: the API routes already return 403 to other roles;
// this just shows a clear message instead of a page of failed requests.
export async function OwnerOnly({ children }: { children: React.ReactNode }) {
  const user = await requireRole("owner");
  if (!user) {
    return <EmptyState title="Owner access only" description="Sign in as the owner to see accounts, costs and the assistant." />;
  }
  return <>{children}</>;
}
