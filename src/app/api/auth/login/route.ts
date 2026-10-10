import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login, ROLE_HOME } from "@/lib/auth";
import { db } from "@/lib/db";
import { parsePreferences } from "@/lib/preferences";
import { navForRole } from "@/components/layout/nav-config";

const loginSchema = z.object({
  name: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const user = await login(parsed.data.name, parsed.data.password, req.headers.get("user-agent"));
  if (!user) {
    return NextResponse.json(
      { fieldErrors: { password: ["Invalid username or password"] } },
      { status: 400 },
    );
  }

  // Honour the user's chosen start page, but only one their role can open.
  const row = await db.user.findUnique({ where: { id: user.id }, select: { preferences: true } });
  const start = parsePreferences(row?.preferences).startPage;
  const allowed = start && navForRole(user.role).some((i) => i.href === start);
  return NextResponse.json({ user, redirectTo: allowed ? start : ROLE_HOME[user.role] });
}
