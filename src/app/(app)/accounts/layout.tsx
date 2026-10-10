import { AccountsTabs } from "@/components/accounts/AccountsTabs";
import { OwnerOnly } from "@/components/accounts/OwnerOnly";

// Reads the session to gate owner-only content — never prerender.
export const instant = false;

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  return (
    <OwnerOnly>
      <div className="flex flex-col gap-4">
        <AccountsTabs />
        {children}
      </div>
    </OwnerOnly>
  );
}
