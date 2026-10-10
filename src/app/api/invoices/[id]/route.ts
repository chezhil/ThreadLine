import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { reversalSummary } from "@/lib/reversals";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      order: { include: { buyer: true } },
      payments: { include: { reversal: reversalSummary } },
      reversal: reversalSummary,
    },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ invoice });
}
