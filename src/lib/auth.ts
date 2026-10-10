import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "./db";

const SESSION_COOKIE = "threadline_session";

export type Role = "owner" | "storekeeper" | "floor_supervisor" | "qc_inspector";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function login(name: string, password: string) {
  const user = await db.user.findFirst({ where: { name } });
  if (!user) return null;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return { id: user.id, name: user.name, role: user.role as Role };
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const userId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!userId) return null;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return { id: user.id, name: user.name, role: user.role as Role };
}

export async function requireRole(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role)) return null;
  return user;
}

export const ROLE_HOME: Record<Role, string> = {
  owner: "/dashboard",
  storekeeper: "/inventory",
  floor_supervisor: "/production/floor-board",
  qc_inspector: "/quality/qc",
};
