import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// The signed-in user's own recent actions, from the shared audit trail. Only
// what they did themselves; the full trail stays owner-only at /audit.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });

  const rows = await db.auditLog.findMany({
    where: { userId: user.id },
    orderBy: { at: "desc" },
    take: 30,
    select: { id: true, entity: true, entityId: true, action: true, at: true },
  });
  return NextResponse.json({
    activity: rows.map((r) => ({ id: r.id, entity: r.entity, entityId: r.entityId, action: r.action, at: r.at.toISOString() })),
  });
}
