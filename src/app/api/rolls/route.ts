import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createRollSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emitRealtime } from "@/lib/realtime";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const qcStatus = searchParams.get("qcStatus");
    const orderId = searchParams.get("orderId");
    const machineId = searchParams.get("machineId");
    const dispatched = searchParams.get("dispatched");
    const search = searchParams.get("search");

    const where: any = {};

    if (qcStatus) {
      where.qcStatus = qcStatus.toUpperCase();
    }

    if (orderId) {
      where.orderId = orderId;
    }

    if (machineId) {
      where.machineId = machineId;
    }

    if (dispatched === "false") {
      where.dispatchId = null;
    } else if (dispatched === "true") {
      where.dispatchId = { not: null };
    }

    if (search) {
      where.OR = [
        { rollNo: { contains: search } },
        { order: { orderNo: { contains: search } } },
        { qrToken: { contains: search } },
      ];
    }

    const rolls = await db.roll.findMany({
      where,
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
          },
        },
        workOrder: true,
        qcRecords: {
          orderBy: { inspectedAt: "desc" },
        },
        dispatch: true,
      },
      orderBy: { rollNo: "desc" },
    });

    return NextResponse.json(rolls);
  } catch (err: any) {
    console.error("Failed to fetch rolls:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createRollSchema.safeParse(body);

    if (!parsed.success) {
      return handleZodError(parsed.error);
    }

    const data = parsed.data;

    // Check if order exists
    const order = await db.order.findUnique({
      where: { id: data.orderId },
    });
    if (!order) {
      return NextResponse.json(
        { fieldErrors: { orderId: "Specified order not found" } },
        { status: 400 }
      );
    }

    // Generate formatted unique roll number: ROL-YYMM-XXXX
    const count = await db.roll.count();
    const datePrefix = new Date().toISOString().slice(2, 7).replace("-", "");
    const rollNo = `ROL-${datePrefix}-${String(count + 1).padStart(4, "0")}`;

    // Generate unique unguessable qrToken
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: data.orderId,
        workOrderId: data.workOrderId,
        machineId: data.machineId,
        shift: data.shift,
        yarnLotId: data.yarnLotId,
        lengthMetres: data.lengthMetres,
        weightKg: data.weightKg,
        qcStatus: data.qcStatus,
        qrToken,
      },
      include: {
        order: { include: { buyer: true } },
        machine: true,
        yarnLot: { include: { yarnType: true } },
      },
    });

    await logAudit("Roll", roll.id, "CREATE", null, roll);
    emitRealtime("roll:created", roll);

    return NextResponse.json(roll, { status: 201 });
  } catch (err: any) {
    console.error("Failed to create roll:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
