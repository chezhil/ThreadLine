import { NextResponse } from "next/server";
import { getCurrentUser, type Role } from "@/lib/auth";

// Role policy for Module 3's routes, on the foundation's session helper.
// Pass no roles to allow any signed-in user.
export async function qualityActor(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user) return { response: NextResponse.json({ error: "Sign in to continue" }, { status: 401 }) } as const;
  if (roles.length && !roles.includes(user.role)) {
    return { response: NextResponse.json({ error: "Your role cannot do this" }, { status: 403 }) } as const;
  }
  return { user } as const;
}
