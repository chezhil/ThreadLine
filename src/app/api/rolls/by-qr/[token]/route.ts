import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qualityActor, withInspectorNames } from "@/lib/quality/auth";

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
      include: {
        order: {
          include: {
            buyer: true,
          },
        },
        machine: true,
        yarnLot: {
          include: {
            yarnType: true,
            supplier: true,
          },
        },
        workOrder: true,
        qcRecords: {
          orderBy: { inspectedAt: "desc" },
        },
        dispatch: true,
      },
    });

    if (!roll) {
      return NextResponse.json(
        { error: `No roll found matching QR token '${token}'` },
        { status: 404 }
      );
    }

    return NextResponse.json(await withInspectorNames(roll));
  } catch (err: any) {
    console.error("Failed to fetch roll by QR token:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
