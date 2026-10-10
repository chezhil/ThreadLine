import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login, ROLE_HOME } from "@/lib/auth";

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

  const user = await login(parsed.data.name, parsed.data.password);
  if (!user) {
    return NextResponse.json(
      { fieldErrors: { password: ["Invalid username or password"] } },
      { status: 400 },
    );
  }

  return NextResponse.json({ user, redirectTo: ROLE_HOME[user.role] });
}
