import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { forbidden } from "@/lib/accounts/http";

// GET ?orderId=… | ?sourceType=Invoice&sourceId=… — HARDENING_ADDENDUM.md
// item 3's stated payoff: "show me where this number came from" becomes
// "list the ledger rows," owner-only like the rest of Accounts.
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const sp = req.nextUrl.searchParams;
  const orderId = sp.get("orderId");
  const sourceType = sp.get("sourceType");
  const sourceId = sp.get("sourceId");
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? "200"), 1), 1000);

  if (!orderId && !(sourceType && sourceId)) {
    return NextResponse.json({ error: "Pass orderId, or sourceType and sourceId" }, { status: 400 });
  }

  const entries = await db.ledgerEntry.findMany({
    where: orderId ? { orderId } : { sourceType: sourceType!, sourceId: sourceId! },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const byType: Record<string, number> = {};
  for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + e.amount;

  return NextResponse.json({ entries, netByType: byType });
}
