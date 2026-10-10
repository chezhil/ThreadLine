import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { orderStatusUpdateSchema } from "@/lib/validation/order";
import { isValidOrderTransition, type OrderStatus } from "@/lib/tokens";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      buyer: true,
      reservations: { include: { yarnLot: { include: { yarnType: true } } } },
      invoices: true,
    },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ order });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = orderStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const order = await db.order.findUnique({
    where: { id },
    include: { reservations: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const from = order.status as OrderStatus;
  const to = parsed.data.status;

  if (!isValidOrderTransition(from, to)) {
    return NextResponse.json(
      { fieldErrors: { status: [`Cannot move from ${from} to ${to} — status order is fixed`] } },
      { status: 400 },
    );
  }

  if (to === "IN_PRODUCTION" && order.reservations.length === 0) {
    return NextResponse.json(
      { fieldErrors: { status: ["Order cannot move to IN_PRODUCTION until yarn is reserved"] } },
      { status: 400 },
    );
  }

  const updated = await db.order.update({ where: { id }, data: { status: to } });
  await logAudit("Order", id, "status_change", { status: from }, { status: to }, user.id);
  emit(RealtimeEvents.OrderStatus, { orderId: id, status: to });

  return NextResponse.json({ order: updated });
}
