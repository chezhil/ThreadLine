import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentSessionHash, getCurrentUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { readJson } from "@/lib/accounts/http";

// Where the signed-in user is signed in. Ids shown to the browser are a short
// prefix of the stored hash — enough to pick a row, useless for anything else
// (the real credential is the cookie token, which is never stored).
const publicId = (hash: string) => hash.slice(0, 16);

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const here = await currentSessionHash();

  const rows = await db.session.findMany({
    where: { userId: user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  return NextResponse.json({
    sessions: rows.map((s) => ({
      id: publicId(s.tokenHash),
      current: s.tokenHash === here,
      userAgent: s.userAgent,
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    })),
  });
}

// DELETE {} signs out every other device; DELETE { id } signs out one of them.
// The device you're on is never touched here — use Sign out for that.
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  const here = await currentSessionHash();
  const body = (await readJson(req)) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  if (body?.id !== undefined && (!id || !/^[0-9a-f]{16}$/.test(id))) {
    return NextResponse.json({ error: "Unknown session" }, { status: 400 });
  }

  const others = await db.session.findMany({
    where: { userId: user.id, ...(here ? { tokenHash: { not: here } } : {}) },
    select: { tokenHash: true },
  });
  const targets = id ? others.filter((s) => publicId(s.tokenHash) === id) : others;
  if (id && !targets.length) return NextResponse.json({ error: "That session is already gone" }, { status: 404 });

  const res = await db.session.deleteMany({ where: { tokenHash: { in: targets.map((s) => s.tokenHash) } } });
  await logAudit("User", user.id, "SESSIONS_REVOKED", undefined, { count: res.count }, user.id);
  return NextResponse.json({ ok: true, revoked: res.count });
}
