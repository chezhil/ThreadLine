import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { forbidden } from "@/lib/accounts/http";

// GET — owner only: how many requests wait in each approval queue, for the
// dashboard's "waiting for you" card.
export async function GET() {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const where = { status: "PENDING" };
  const [purchase, maintenance, payouts] = await Promise.all([
    db.purchaseRequest.count({ where }),
    db.maintenanceRequest.count({ where }),
    db.payoutApproval.count({ where }),
  ]);
  return NextResponse.json({ purchase, maintenance, payouts, total: purchase + maintenance + payouts });
}
