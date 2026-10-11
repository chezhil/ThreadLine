import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { getCurrentUser } from "@/lib/auth";
import { syncDerivedAlerts } from "@/lib/accounts/alerts";
import { fieldErrorResponse, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { alertsUpdateSchema } from "@/lib/validation/accounts";
import { alertScopeForRole } from "@/lib/accounts/alert-format";

const SEVERITIES = ["info", "warning", "critical"];

// GET ?unread=1&severity=warning&limit=50 — every signed-in role sees alerts.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const severity = sp.get("severity");
  if (severity && !SEVERITIES.includes(severity)) return fieldErrorResponse({ severity: ["Unknown severity"] });
  const limit = Number(sp.get("limit") ?? "100");
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return fieldErrorResponse({ limit: ["limit must be a whole number from 1 to 500"] });
  }

  await syncDerivedAlerts();

  // "Unread" is per user: open (not resolved) and not yet marked read by
  // this user. Marking alerts read no longer hides them for anyone else.
  // Each role only sees (and counts) the alerts it can act on.
  const scope = alertScopeForRole(user.role);
  const unreadForUser = { ...scope, read: false, reads: { none: { userId: user.id } } };
  const where = {
    ...scope,
    ...(sp.get("unread") === "1" ? unreadForUser : {}),
    ...(severity ? { severity } : {}),
  };
  const [rows, unreadCount, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { reads: { where: { userId: user.id }, select: { userId: true } } },
    }),
    db.notification.count({ where: unreadForUser }),
    db.notification.count({ where }),
  ]);
  const notifications = rows.map(({ reads, ...n }) => ({ ...n, read: n.read || reads.length > 0 }));
  return NextResponse.json({ notifications, unreadCount, total });
}

// PATCH { ids: [...] } or { all: true }, optional read: false to mark unread.
// Applies to the signed-in user's own read marks only.
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = alertsUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { ids, all, read } = parsed.data;

  // Inside one write transaction so a double-click can't insert the same
  // (notification, user) mark twice.
  const updated = await writeTransaction(async (tx) => {
    const targets = await tx.notification.findMany({
      where: {
        ...alertScopeForRole(user.role),
        ...(all ? {} : { id: { in: ids } }),
        reads: read ? { none: { userId: user.id } } : { some: { userId: user.id } },
      },
      select: { id: true },
    });
    const targetIds = targets.map((t) => t.id);
    if (!targetIds.length) return 0;
    if (read) {
      return (
        await tx.notificationRead.createMany({ data: targetIds.map((notificationId) => ({ notificationId, userId: user.id })) })
      ).count;
    }
    return (await tx.notificationRead.deleteMany({ where: { userId: user.id, notificationId: { in: targetIds } } })).count;
  });
  const unreadCount = await db.notification.count({ where: { ...alertScopeForRole(user.role), read: false, reads: { none: { userId: user.id } } } });
  return NextResponse.json({ updated, unreadCount });
}
