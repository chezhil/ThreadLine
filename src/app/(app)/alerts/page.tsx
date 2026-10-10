import { AlertsClient } from "@/components/alerts/AlertsClient";
import { getCurrentUser } from "@/lib/auth";

export const instant = false;

export default async function AlertsPage() {
  const user = await getCurrentUser();
  return <AlertsClient showOutbox={user?.role === "owner"} />;
}
