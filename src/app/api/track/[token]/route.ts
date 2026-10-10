import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Public, no auth — a buyer reaches this with only the tracking token.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const order = await db.order.findUnique({
    where: { trackingToken: token },
    include: {
      buyer: { select: { name: true } },
      rolls: { select: { id: true, qcStatus: true, dispatchId: true } },
      reservations: true,
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rollsTotal = order.rolls.length;
  const rollsReady = order.rolls.filter((r) => r.qcStatus === "PASS").length;
  const rollsDispatched = order.rolls.filter((r) => !!r.dispatchId).length;

  const stageFromStatus: Record<string, string> = {
    NEW: "Order placed",
    CONFIRMED: order.reservations.length > 0 ? "Yarn reserved" : "Confirmed",
    IN_PRODUCTION: "In production (weaving/dyeing)",
    QC: "Quality check",
    READY: "Ready for dispatch",
    DISPATCHED: "Dispatched",
    CLOSED: "Delivered",
  };

  return NextResponse.json({
    orderNo: order.orderNo,
    buyerName: order.buyer.name,
    fabricType: order.fabricType,
    colour: order.colour,
    qtyMetres: order.qtyMetres,
    deadline: order.deadline,
    status: order.status,
    stage: stageFromStatus[order.status] ?? order.status,
    rollsReady,
    rollsTotal,
    rollsDispatched,
    estimatedDelivery: order.deadline,
  });
}
