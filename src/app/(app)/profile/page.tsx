import { AccountClient } from "@/components/account/AccountClient";
import { isAccountTab } from "@/components/account/tabs";

export const instant = false;

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams;
  const wanted = Array.isArray(tab) ? tab[0] : tab;
  return <AccountClient initialTab={isAccountTab(wanted) ? wanted : "profile"} />;
}
