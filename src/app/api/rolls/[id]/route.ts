import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qualityActor } from "@/lib/quality/auth";
import { presentRolls, rollInclude } from "@/lib/quality/roll-view";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await qualityActor();
  if ("response" in actor) return actor.response;
  try {
    const { id } = await params;

    const roll = await db.roll.findUnique({
      where: { id },
      include: rollInclude(actor.user.role, { supplier: true }),
    });

    if (!roll) {
      return NextResponse.json({ error: "Roll not found" }, { status: 404 });
    }

    return NextResponse.json((await presentRolls([roll]))[0]);
  } catch (err) {
    console.error("Failed to fetch roll:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
