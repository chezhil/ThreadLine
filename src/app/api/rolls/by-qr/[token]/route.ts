import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qualityActor } from "@/lib/quality/auth";
import { presentRolls, rollInclude } from "@/lib/quality/roll-view";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const actor = await qualityActor();
  if ("response" in actor) return actor.response;
  try {
    const { token } = await params;

    const roll = await db.roll.findUnique({
      where: { qrToken: token },
      include: rollInclude(actor.user.role, { supplier: true }),
    });

    if (!roll) {
      return NextResponse.json(
        { error: `No roll found matching QR token '${token}'` },
        { status: 404 }
      );
    }

    return NextResponse.json((await presentRolls([roll]))[0]);
  } catch (err) {
    console.error("Failed to fetch roll by QR token:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
