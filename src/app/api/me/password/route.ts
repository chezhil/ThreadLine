import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentSessionHash, getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { fieldErrorResponse, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { passwordSchema } from "@/lib/validation/profile";

// Wrong "current password" guesses per user, so a hijacked session can't be
// used to brute-force the real password. In-memory: resets on restart, which
// only ever loosens it for one window.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map<string, { count: number; first: number }>();

function tooManyFailures(userId: string) {
  const f = failures.get(userId);
  if (!f) return false;
  if (Date.now() - f.first > WINDOW_MS) {
    failures.delete(userId);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const parsed = passwordSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { currentPassword, newPassword } = parsed.data;

  if (tooManyFailures(user.id)) {
    return NextResponse.json({ error: "Too many wrong attempts. Try again in a few minutes." }, { status: 429 });
  }

  const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true } });
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    const f = failures.get(user.id);
    failures.set(user.id, f && Date.now() - f.first <= WINDOW_MS ? { ...f, count: f.count + 1 } : { count: 1, first: Date.now() });
    return fieldErrorResponse({ currentPassword: ["That isn't your current password"] });
  }
  if (await verifyPassword(newPassword, row.passwordHash)) {
    return fieldErrorResponse({ newPassword: ["Choose a password you haven't been using"] });
  }

  failures.delete(user.id);
  const passwordHash = await hashPassword(newPassword);
  // Changing the password signs every other device out; this one stays.
  const keep = await currentSessionHash();
  const [, revoked] = await db.$transaction([
    db.user.update({ where: { id: user.id }, data: { passwordHash } }),
    db.session.deleteMany({ where: { userId: user.id, ...(keep ? { tokenHash: { not: keep } } : {}) } }),
  ]);
  await logAudit("User", user.id, "PASSWORD_CHANGED", undefined, { otherSessionsSignedOut: revoked.count }, user.id);
  return NextResponse.json({ ok: true, signedOutElsewhere: revoked.count });
}
