import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, ROLE_HOME } from "@/lib/auth";
import { fieldErrorResponse, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { parsePreferences, preferencesPatchSchema } from "@/lib/preferences";
import { navForRole } from "@/components/layout/nav-config";

// PATCH a subset of the user's interface preferences; the rest are kept.
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const parsed = preferencesPatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  if (!Object.keys(parsed.data).length) return fieldErrorResponse({ _form: ["Nothing to update"] });

  // A start page must be somewhere this role can actually open.
  const start = parsed.data.startPage;
  if (start && start !== ROLE_HOME[user.role] && !navForRole(user.role).some((i) => i.href === start)) {
    return fieldErrorResponse({ startPage: ["Your role can't open that page"] });
  }

  // Read-merge-write inside one transaction so two quick toggles (different
  // keys, different requests) don't overwrite each other.
  const merged = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const row = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { preferences: true } });
    const next = { ...parsePreferences(row.preferences), ...parsed.data };
    await tx.user.update({ where: { id: user.id }, data: { preferences: JSON.stringify(next) } });
    return next;
  });
  return NextResponse.json({ preferences: merged });
}

// navigator.sendBeacon (used to save a toggle made just before leaving the
// page) can only POST.
export async function POST(req: NextRequest) {
  return PATCH(req);
}
