import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { checkLowStockAndNotify } from "@/lib/inventory";

const reserveSchema = z.object({
  yarnLotId: z.string().min(1),
  qtyKg: z.number().positive("Reservation quantity must be positive (kg)"),
});

// Additive route, not in the fixed list — needed so "Order cannot move to
// IN_PRODUCTION unless yarn is reserved" (section 7 of the spec) has a real
// mechanism. Lives under Orders because it writes OrderYarnReservation, which
// this module owns.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: orderId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = reserveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const [order, yarnLot] = await Promise.all([
    db.order.findUnique({ where: { id: orderId } }),
    db.yarnLot.findUnique({ where: { id: parsed.data.yarnLotId } }),
  ]);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!yarnLot) {
    return NextResponse.json({ fieldErrors: { yarnLotId: ["Yarn lot not found"] } }, { status: 400 });
  }
  if (parsed.data.qtyKg > yarnLot.qtyRemainingKg) {
    return NextResponse.json(
      { fieldErrors: { qtyKg: [`Only ${yarnLot.qtyRemainingKg}kg remaining in this lot`] } },
      { status: 400 },
    );
  }

  const [reservation] = await db.$transaction([
    db.orderYarnReservation.create({
      data: { orderId, yarnLotId: parsed.data.yarnLotId, qtyKg: parsed.data.qtyKg },
    }),
    db.yarnLot.update({
      where: { id: parsed.data.yarnLotId },
      data: { qtyRemainingKg: { decrement: parsed.data.qtyKg } },
    }),
  ]);

  await logAudit("OrderYarnReservation", reservation.id, "create", null, reservation, user.id);
  await checkLowStockAndNotify(yarnLot.yarnTypeId);

  return NextResponse.json({ reservation }, { status: 201 });
}
