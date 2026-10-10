import { EmptyState } from "@/components/ui";
import { SectionTabs } from "@/components/layout/SectionTabs";
import { requireRole } from "@/lib/auth";

// Reads the session to gate the quality screens — never prerender.
export const instant = false;

const TABS = [
  { href: "/quality/qc", label: "QC queue" },
  { href: "/quality/rolls", label: "Rolls & labels" },
  { href: "/quality/defects", label: "Defect analytics" },
];

export default async function QualityLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole("owner", "qc_inspector");
  if (!user) {
    return <EmptyState title="Quality access only" description="Sign in as the owner or a QC inspector to inspect rolls and see defect analytics." />;
  }
  return (
    <div className="flex flex-col gap-4">
      <SectionTabs label="Quality sections" tabs={TABS} />
      {children}
    </div>
  );
}
