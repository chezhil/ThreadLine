import { redirect } from "next/navigation";
import { getCurrentUser, ROLE_HOME } from "@/lib/auth";

export const instant = false;

export default async function RootPage() {
  const user = await getCurrentUser();
  redirect(user ? ROLE_HOME[user.role] : "/login");
}
