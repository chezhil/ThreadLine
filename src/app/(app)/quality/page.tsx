import { redirect } from "next/navigation";

// /quality has no page of its own (breadcrumbs link here) — open the QC queue.
export default function QualityIndex() {
  redirect("/quality/qc");
}
