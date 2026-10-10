import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qcInspectionSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emitRealtime } from "@/lib/realtime";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();

    const parsed = qcInspectionSchema.safeParse(body);
    if (!parsed.success) {
      return handleZodError(parsed.error);
    }

    const data = parsed.data;

    // Check if roll exists
    const roll = await db.roll.findUnique({
      where: { id },
      include: {
        qcRecords: {
          orderBy: { inspectedAt: "desc" },
          take: 1,
        },
      },
    });

    if (!roll) {
      return NextResponse.json({ error: `Roll not found: ${id}` }, { status: 404 });
    }

    // A roll that has already been dispatched cannot be altered
    if (roll.dispatchId) {
      return NextResponse.json(
        { error: "This roll has already been dispatched and cannot be re-inspected." },
        { status: 400 }
      );
    }

    const previousStatus = roll.qcStatus;

    // Create the QC record and update the roll status atomically
    const [qcRecord, updatedRoll] = await db.$transaction([
      db.qCRecord.create({
        data: {
          rollId: roll.id,
          inspectorId: data.inspectorId,
          result: data.result,
          defects: JSON.stringify(data.defects || []),
          notes: data.notes || null,
        },
      }),
      db.roll.update({
        where: { id: roll.id },
        data: {
          qcStatus: data.result,
        },
        include: {
          order: true,
          machine: true,
          yarnLot: true,
        },
      }),
    ]);

    await logAudit(
      "Roll",
      roll.id,
      "QC_INSPECT",
      { qcStatus: previousStatus },
      { qcStatus: data.result, defects: data.defects, notes: data.notes },
      data.inspectorId
    );

    emitRealtime("qc:completed", {
      rollId: roll.id,
      rollNo: roll.rollNo,
      result: data.result,
      inspectorId: data.inspectorId,
    });

    return NextResponse.json({
      success: true,
      qcRecord,
      roll: updatedRoll,
    });
  } catch (err: any) {
    console.error("Failed to submit QC inspection:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
