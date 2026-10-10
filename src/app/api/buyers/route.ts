import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { buyerSchema } from "@/lib/validation/order";

export async function GET() {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const buyers = await db.buyer.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ buyers });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = buyerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const buyer = await db.buyer.create({ data: parsed.data });
  return NextResponse.json({ buyer }, { status: 201 });
}
