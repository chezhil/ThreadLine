import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { syncDerivedAlerts } from "@/lib/accounts/alerts";
import { fieldErrorResponse, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { alertsUpdateSchema } from "@/lib/validation/accounts";

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

  const where = {
    ...(sp.get("unread") === "1" ? { read: false } : {}),
    ...(severity ? { severity } : {}),
  };
  const [notifications, unreadCount, total] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    db.notification.count({ where: { read: false } }),
    db.notification.count({ where }),
  ]);
  return NextResponse.json({ notifications, unreadCount, total });
}

// PATCH { ids: [...] } or { all: true }, optional read: false to mark unread.
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = alertsUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { ids, all, read } = parsed.data;

  const result = await db.notification.updateMany({
    where: all ? { read: !read } : { id: { in: ids } },
    data: { read },
  });
  const unreadCount = await db.notification.count({ where: { read: false } });
  return NextResponse.json({ updated: result.count, unreadCount });
}
