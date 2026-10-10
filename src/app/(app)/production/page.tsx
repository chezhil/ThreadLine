import { redirect } from "next/navigation";

// /production has no page of its own (breadcrumbs link here) — open the floor board.
export default function ProductionIndex() {
  redirect("/production/floor-board");
}
