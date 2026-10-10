import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "./db";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface AuthSession {
  userId: string;
  name: string;
  role: string;
}

export async function getSession(): Promise<AuthSession | null> {
  const cookieStore = cookies();
  const sessionToken = cookieStore.get("threadline_session")?.value;
  if (!sessionToken) return null;

  try {
    const parsed = JSON.parse(Buffer.from(sessionToken, "base64").toString("utf-8"));
    return parsed as AuthSession;
  } catch {
    return null;
  }
}
