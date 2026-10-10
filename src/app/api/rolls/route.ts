import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createRollSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import crypto from "crypto";


export async function GET(req: NextRequest) {
  const actor = await qualityActor();
  if ("response" in actor) return actor.response;
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
  const actor = await qualityActor("owner", "floor_supervisor", "qc_inspector");
  if ("response" in actor) return actor.response;
  try {
    const body = await req.json().catch(() => null);
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

    // The roll's work order must belong to this order; machine and lot must exist.
    const [workOrder, machine, yarnLot] = await Promise.all([
      db.workOrder.findUnique({ where: { id: data.workOrderId } }),
      db.machine.findUnique({ where: { id: data.machineId } }),
      db.yarnLot.findUnique({ where: { id: data.yarnLotId } }),
    ]);
    const refErrors: Record<string, string> = {};
    if (!workOrder || workOrder.orderId !== data.orderId) refErrors.workOrderId = "Work order not found for this order";
    if (!machine) refErrors.machineId = "Machine not found";
    if (!yarnLot) refErrors.yarnLotId = "Yarn lot not found";
    if (Object.keys(refErrors).length) {
      return NextResponse.json({ fieldErrors: refErrors, error: "Validation failed" }, { status: 400 });
    }

    // Generate formatted unique roll number: ROL-YYMM-XXXX (skip numbers already taken)
    const datePrefix = new Date().toISOString().slice(2, 7).replace("-", "");
    let seq = (await db.roll.count()) + 1;
    while (await db.roll.findUnique({ where: { rollNo: `ROL-${datePrefix}-${String(seq).padStart(4, "0")}` } })) seq++;
    const rollNo = `ROL-${datePrefix}-${String(seq).padStart(4, "0")}`;

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

    await logAudit("Roll", roll.id, "CREATE", null, roll, actor.user.id);
    emit(RealtimeEvents.RollCreated, { rollId: roll.id, rollNo: roll.rollNo, orderId: roll.orderId });

    return NextResponse.json(roll, { status: 201 });
  } catch (err: any) {
    console.error("Failed to create roll:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
