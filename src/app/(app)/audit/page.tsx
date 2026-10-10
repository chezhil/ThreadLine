import { OwnerOnly } from "@/components/accounts/OwnerOnly";
import { AuditClient } from "@/components/audit/AuditClient";

export const instant = false;

export default function AuditPage() {
  return (
    <OwnerOnly>
      <AuditClient />
    </OwnerOnly>
  );
}
