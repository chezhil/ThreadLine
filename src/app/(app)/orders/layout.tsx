import { OwnerOnly } from "@/components/accounts/OwnerOnly";
import { SectionTabs } from "@/components/layout/SectionTabs";

// Reads the session to gate owner-only content — never prerender.
export const instant = false;

const TABS = [
  { href: "/orders", label: "Orders" },
  { href: "/orders/buyers", label: "Buyers" },
];

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return (
    <OwnerOnly>
      <div className="flex flex-col gap-4">
        <SectionTabs label="Orders sections" tabs={TABS} />
        {children}
      </div>
    </OwnerOnly>
  );
}
