import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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

/** Adds the inspector's name to each QC record (inspectorId is a User id). */
export async function withInspectorNames<T extends { qcRecords: { inspectorId: string }[] }>(roll: T) {
  const ids = [...new Set(roll.qcRecords.map((r) => r.inspectorId))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { ...roll, qcRecords: roll.qcRecords.map((r) => ({ ...r, inspectorName: names.get(r.inspectorId) ?? r.inspectorId })) };
}
