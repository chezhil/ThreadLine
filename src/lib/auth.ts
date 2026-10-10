import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { db } from "./db";
import { parsePreferences } from "./preferences";

const SESSION_COOKIE = "threadline_session";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 7;

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type Role = "owner" | "storekeeper" | "floor_supervisor" | "qc_inspector";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function login(name: string, password: string, userAgent?: string | null) {
  const user = await db.user.findFirst({ where: { name } });
  if (!user) return null;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;
  await db.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_AGE_SECONDS * 1000);
  await db.session.create({
    data: { tokenHash: tokenHash(token), userId: user.id, expiresAt, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_AGE_SECONDS,
  });
  return { id: user.id, name: user.name, role: user.role as Role };
}

export async function logout() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    // Explicit columns: the user row can carry a profile picture, and this
    // runs on every authenticated API call.
    include: { user: { select: { id: true, name: true, role: true } } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  const { user } = session;
  return { id: user.id, name: user.name, role: user.role as Role };
}

/** Hash of the current request's session token (to mark "this device"). */
export async function currentSessionHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? tokenHash(token) : null;
}

/** The signed-in user with profile and preferences, for the app shell and the
 * account page. Cached per request so the layout and page share one query. */
export const getCurrentProfile = cache(async () => {
  const me = await getCurrentUser();
  if (!me) return null;
  const row = await db.user.findUnique({ where: { id: me.id } });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role as Role,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    jobTitle: row.jobTitle,
    avatar: row.avatar,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    preferences: parsePreferences(row.preferences),
  };
});

export type CurrentProfile = NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>;

export async function requireRole(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

export { ROLE_HOME } from "./role-home";
