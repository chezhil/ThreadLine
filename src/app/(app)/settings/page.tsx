import { redirect } from "next/navigation";

export const instant = false;

// "Settings" lives on the profile page; this keeps /settings working as a link.
export default function Page() {
  redirect("/profile?tab=preferences");
}
