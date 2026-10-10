import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { fieldErrorResponse, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { profileSchema } from "@/lib/validation/profile";

// The signed-in user's own profile. Every role may read and edit their own;
// nobody can touch another user's, because the id always comes from the session.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  return NextResponse.json({ profile });
}

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const parsed = profileSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  if (!Object.keys(parsed.data).length) return fieldErrorResponse({ _form: ["Nothing to update"] });

  const before = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { fullName: true, email: true, phone: true, jobTitle: true },
  });
  await db.user.update({ where: { id: user.id }, data: parsed.data });

  // The picture itself is not written to the audit trail, only that it changed.
  const { avatar, ...fields } = parsed.data;
  await logAudit(
    "User",
    user.id,
    "PROFILE_UPDATED",
    before,
    { ...fields, ...(avatar !== undefined ? { avatar: avatar === null ? "removed" : "changed" } : {}) },
    user.id,
  );

  const profile = await getCurrentProfileFresh(user.id);
  return NextResponse.json({ profile });
}

// getCurrentProfile is cached per request, so after a write re-read directly.
async function getCurrentProfileFresh(id: string) {
  const row = await db.user.findUniqueOrThrow({ where: { id } });
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    jobTitle: row.jobTitle,
    avatar: row.avatar,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
