import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createRollSchema } from "@/lib/validation/roll";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import { withRetry, writeTransaction } from "@/lib/concurrency";
import { recomputeRollAggregates, recordStatusChanges } from "@/lib/order-status";
import { presentRolls, rollInclude } from "@/lib/quality/roll-view";


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

    const where: Prisma.RollWhereInput = {};

    if (qcStatus) {
      const wanted = qcStatus.toUpperCase();
      if (!["PENDING", "PASS", "REWORK", "REJECT"].includes(wanted)) {
        return NextResponse.json({ fieldErrors: { qcStatus: "Unknown QC status" } }, { status: 400 });
      }
      where.qcStatus = wanted;
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
      include: rollInclude(actor.user.role),
      orderBy: { rollNo: "desc" },
    });

    return NextResponse.json(await presentRolls(rolls));
  } catch (err) {
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

    // Check if order exists and is somewhere rolls can come from
    const order = await db.order.findUnique({
      where: { id: data.orderId },
    });
    if (!order) {
      return NextResponse.json(
        { fieldErrors: { orderId: "Specified order not found" } },
        { status: 400 }
      );
    }
    if (order.status === "NEW" || order.status === "CONFIRMED" || order.status === "CLOSED") {
      return NextResponse.json(
        { fieldErrors: { orderId: `Rolls can't be added to an order that is ${order.status}` } },
        { status: 400 }
      );
    }

    // Lineage must be consistent: the roll comes off a WEAVING work order of
    // this order, on that work order's loom, from yarn reserved for (or
    // received against, or already used by) this order.
    const [workOrder, machine, yarnLot] = await Promise.all([
      db.workOrder.findUnique({ where: { id: data.workOrderId } }),
      db.machine.findUnique({ where: { id: data.machineId } }),
      db.yarnLot.findUnique({ where: { id: data.yarnLotId }, include: { reservations: { select: { orderId: true } } } }),
    ]);
    const refErrors: Record<string, string> = {};
    if (!workOrder || workOrder.orderId !== data.orderId) refErrors.workOrderId = "Work order not found for this order";
    else if (workOrder.stage !== "weaving") refErrors.workOrderId = "Rolls come off the weaving work order";
    if (!machine) refErrors.machineId = "Machine not found";
    else if (workOrder && machine.id !== workOrder.machineId) refErrors.machineId = "Use the loom this work order runs on";
    if (!yarnLot) refErrors.yarnLotId = "Yarn lot not found";
    else if (
      yarnLot.linkedOrderId !== data.orderId &&
      !yarnLot.reservations.some((r) => r.orderId === data.orderId) &&
      // Orders seeded or started before reservations were enforced: the lot
      // its earlier rolls came from still counts as its yarn.
      !(await db.roll.count({ where: { orderId: data.orderId, yarnLotId: yarnLot.id } }))
    ) {
      refErrors.yarnLotId = "This yarn lot isn't reserved for this order";
    }
    if (Object.keys(refErrors).length) {
      return NextResponse.json({ fieldErrors: refErrors, error: "Validation failed" }, { status: 400 });
    }

    // Generate unique unguessable qrToken
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    // Roll number = next free ROL-YYMM-NNNN, computed inside the write
    // transaction (and retried on a unique clash) so two rolls minted at the
    // same moment can't pick the same number. The order's QC/dispatch
    // aggregates are refreshed in the same transaction: a new PENDING roll
    // puts a READY order back into QC.
    const { roll, statusChange } = await withRetry(() =>
      writeTransaction(async (tx) => {
        const datePrefix = new Date().toISOString().slice(2, 7).replace("-", "");
        let seq = (await tx.roll.count()) + 1;
        while (await tx.roll.findUnique({ where: { rollNo: `ROL-${datePrefix}-${String(seq).padStart(4, "0")}` } })) seq++;
        const rollNo = `ROL-${datePrefix}-${String(seq).padStart(4, "0")}`;
        const roll = await tx.roll.create({
          data: {
            rollNo,
            orderId: data.orderId,
            workOrderId: data.workOrderId,
            machineId: data.machineId,
            shift: data.shift,
            yarnLotId: data.yarnLotId,
            lengthMetres: data.lengthMetres,
            weightKg: data.weightKg,
            qcStatus: "PENDING",
            qrToken,
          },
          include: rollInclude(actor.user.role),
        });
        const statusChange = await recomputeRollAggregates(tx, data.orderId);
        return { roll, statusChange };
      }),
    );

    await logAudit("Roll", roll.id, "CREATE", null, { rollNo: roll.rollNo, orderId: roll.orderId, lengthMetres: roll.lengthMetres }, actor.user.id);
    await recordStatusChanges([statusChange], actor.user.id);
    emit(RealtimeEvents.RollCreated, { rollId: roll.id, rollNo: roll.rollNo, orderId: roll.orderId });

    return NextResponse.json((await presentRolls([roll]))[0], { status: 201 });
  } catch (err) {
    console.error("Failed to create roll:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
