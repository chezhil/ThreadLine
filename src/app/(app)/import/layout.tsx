import { OwnerOnly } from "@/components/accounts/OwnerOnly";

// Reads the session to gate owner-only content — never prerender.
export const instant = false;

export default function ImportLayout({ children }: { children: React.ReactNode }) {
  return <OwnerOnly description="Sign in as the owner to import legacy records.">{children}</OwnerOnly>;
}
