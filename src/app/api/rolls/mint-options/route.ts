import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { qualityActor } from "@/lib/quality/auth";

// What the "Mint roll" form can pick from: weaving work orders of orders that
// are in production or later (not NEW/CONFIRMED/CLOSED), each with its loom
// and the yarn lots reserved for, received against or already used by its
// order. The roll
// API enforces the same rules; this just keeps the form to valid choices.
export async function GET() {
  const actor = await qualityActor("owner", "floor_supervisor", "qc_inspector");
  if ("response" in actor) return actor.response;

  const workOrders = await db.workOrder.findMany({
    where: { stage: "weaving", order: { status: { notIn: ["NEW", "CONFIRMED", "CLOSED"] } } },
    include: {
      machine: { select: { id: true, name: true, type: true } },
      order: {
        select: {
          id: true,
          orderNo: true,
          fabricType: true,
          colour: true,
          reservations: { select: { yarnLot: { include: { yarnType: { select: { name: true, count: true, colour: true } } } } } },
          rolls: {
            distinct: ["yarnLotId"],
            select: { yarnLot: { include: { yarnType: { select: { name: true, count: true, colour: true } } } } },
          },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });
  const linked = await db.yarnLot.findMany({
    where: { linkedOrderId: { in: workOrders.map((w) => w.orderId) } },
    include: { yarnType: { select: { name: true, count: true, colour: true } } },
  });

  return NextResponse.json({
    workOrders: workOrders.map((w) => {
      const lots = new Map<string, { id: string; lotNo: string; yarnType: string }>();
      for (const r of [...w.order.reservations, ...w.order.rolls]) {
        const l = r.yarnLot;
        lots.set(l.id, { id: l.id, lotNo: l.lotNo, yarnType: `${l.yarnType.name} ${l.yarnType.count} ${l.yarnType.colour}` });
      }
      for (const l of linked.filter((x) => x.linkedOrderId === w.orderId)) {
        lots.set(l.id, { id: l.id, lotNo: l.lotNo, yarnType: `${l.yarnType.name} ${l.yarnType.count} ${l.yarnType.colour}` });
      }
      return {
        id: w.id,
        status: w.status,
        plannedQty: w.plannedQty,
        producedQty: w.producedQty,
        order: { id: w.order.id, orderNo: w.order.orderNo, fabricType: w.order.fabricType, colour: w.order.colour },
        machine: w.machine,
        yarnLots: [...lots.values()],
      };
    }),
  });
}
