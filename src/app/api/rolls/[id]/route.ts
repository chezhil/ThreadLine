import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qualityActor, withInspectorNames } from "@/lib/quality/auth";

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
      return NextResponse.json({ error: "Roll not found" }, { status: 404 });
    }

    return NextResponse.json(await withInspectorNames(roll));
  } catch (err: any) {
    console.error("Failed to fetch roll:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
