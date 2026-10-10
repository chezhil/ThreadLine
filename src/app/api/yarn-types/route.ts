import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { yarnTypeSchema } from "@/lib/validation/yarn";

export async function GET() {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const yarnTypes = await db.yarnType.findMany({
    include: { lots: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ yarnTypes });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = yarnTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const yarnType = await db.yarnType.create({ data: parsed.data });
  return NextResponse.json({ yarnType }, { status: 201 });
}
