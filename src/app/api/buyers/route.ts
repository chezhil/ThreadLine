import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { buyerSchema } from "@/lib/validation/order";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";

// Archived buyers are listed too (flagged) so the Buyers screen can restore
// them; pickers that start new orders leave them out.
export async function GET() {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const buyers = await db.buyer.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { orders: true, dispatches: true } } },
  });
  return NextResponse.json({ buyers });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = buyerSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const clash = await db.buyer.findFirst({ where: { name: parsed.data.name } });
  if (clash) return fieldErrorResponse({ name: ["A buyer with this name already exists"] }, 409);

  const buyer = await db.buyer.create({ data: parsed.data });
  await logAudit("Buyer", buyer.id, "create", null, buyer, user.id);
  return NextResponse.json({ buyer }, { status: 201 });
}
