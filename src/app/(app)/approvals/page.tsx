import { ApprovalsClient } from "@/components/approvals/ApprovalsClient";
import { OwnerOnly } from "@/components/accounts/OwnerOnly";

export const instant = false;

export default function ApprovalsPage() {
  return (
    <OwnerOnly>
      <ApprovalsClient />
    </OwnerOnly>
  );
}
