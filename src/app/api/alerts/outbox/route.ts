import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";

// GET ?limit=50 — owner-only view of the delivery outbox (HARDENING_ADDENDUM.md
// item 6): every WhatsApp/SMS/email push queued for a buyer, and whether it
// actually went out, failed, or is waiting to retry.
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit") ?? "50"), 1), 200);

  const [deliveries, pending] = await Promise.all([
    db.alertDelivery.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    db.alertDelivery.count({ where: { status: { in: ["PENDING", "RETRYING"] } } }),
  ]);

  return NextResponse.json({ deliveries, pendingCount: pending });
}
