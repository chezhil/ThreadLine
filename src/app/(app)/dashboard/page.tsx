import { OwnerOnly } from "@/components/accounts/OwnerOnly";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

export const instant = false;

export default function Page() {
  return (
    <OwnerOnly>
      <DashboardClient />
    </OwnerOnly>
  );
}
