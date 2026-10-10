import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const { token } = params;

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

    return NextResponse.json(roll);
  } catch (err: any) {
    console.error("Failed to fetch roll by QR token:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
