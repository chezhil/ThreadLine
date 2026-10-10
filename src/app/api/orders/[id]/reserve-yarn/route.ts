import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { checkLowStockAndNotify } from "@/lib/inventory";
import { withRetry } from "@/lib/concurrency";

const reserveSchema = z.object({
  yarnLotId: z.string().min(1),
  qtyKg: z.number().positive("Reservation quantity must be positive (kg)"),
});

class InsufficientStock extends Error {
  constructor(public remainingKg: number) {
    super(`Only ${remainingKg}kg remaining in this lot`);
  }
}

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

  const [order, yarnLotExists] = await Promise.all([
    db.order.findUnique({ where: { id: orderId } }),
    db.yarnLot.findUnique({ where: { id: parsed.data.yarnLotId } }),
  ]);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!yarnLotExists) {
    return NextResponse.json({ fieldErrors: { yarnLotId: ["Yarn lot not found"] } }, { status: 400 });
  }

  // The sufficiency check and the decrement must happen on the same read —
  // doing the check before the transaction (as this used to) lets two
  // concurrent reservations both pass against the same stale remaining
  // figure and both decrement, driving stock negative. Re-reading inside the
  // transaction makes SQLite serialise the two attempts instead.
  let reservation;
  try {
    reservation = await withRetry(() =>
      db.$transaction(async (tx) => {
        const yarnLot = await tx.yarnLot.findUniqueOrThrow({ where: { id: parsed.data.yarnLotId } });
        if (parsed.data.qtyKg > yarnLot.qtyRemainingKg) {
          throw new InsufficientStock(yarnLot.qtyRemainingKg);
        }
        const created = await tx.orderYarnReservation.create({
          data: { orderId, yarnLotId: parsed.data.yarnLotId, qtyKg: parsed.data.qtyKg },
        });
        await tx.yarnLot.update({
          where: { id: parsed.data.yarnLotId },
          data: { qtyRemainingKg: { decrement: parsed.data.qtyKg } },
        });
        return created;
      }),
    );
  } catch (e) {
    if (e instanceof InsufficientStock) {
      return NextResponse.json({ fieldErrors: { qtyKg: [e.message] } }, { status: 400 });
    }
    throw e;
  }

  await logAudit("OrderYarnReservation", reservation.id, "create", null, reservation, user.id);
  await checkLowStockAndNotify(yarnLotExists.yarnTypeId);

  return NextResponse.json({ reservation }, { status: 201 });
}
