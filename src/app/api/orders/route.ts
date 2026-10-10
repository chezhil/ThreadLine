import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { orderCreateSchema } from "@/lib/validation/order";
import { generateOrderNo, generateTrackingToken } from "@/lib/order-numbers";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { withRetry, writeTransaction } from "@/lib/concurrency";
import { storedFeasibility } from "@/lib/feasibility";

export async function GET() {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orders = await db.order.findMany({
    include: { buyer: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ orders });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = orderCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const buyer = await db.buyer.findUnique({ where: { id: parsed.data.buyerId } });
  if (!buyer) {
    return NextResponse.json({ fieldErrors: { buyerId: ["Buyer not found"] } }, { status: 400 });
  }
  if (buyer.archivedAt) {
    return NextResponse.json({ fieldErrors: { buyerId: ["This buyer is archived; restore it first"] } }, { status: 400 });
  }

  // Order numbers are "count of existing orders + 1" — two concurrent order
  // creations could otherwise compute the same number. The transaction makes
  // one attempt atomic (SQLite serialises the write), withRetry re-attempts
  // from scratch (fresh count) if it still collides.
  const { yarnTypeId, wastagePct, ...orderData } = parsed.data;
  let feasibilityResult: string | null = null;
  if (yarnTypeId) {
    const yarnType = await db.yarnType.findUnique({ where: { id: yarnTypeId } });
    if (!yarnType) return NextResponse.json({ fieldErrors: { yarnTypeId: ["Yarn type not found"] } }, { status: 400 });
    if (yarnType.archivedAt) {
      return NextResponse.json({ fieldErrors: { yarnTypeId: ["This yarn type is archived; restore it first"] } }, { status: 400 });
    }
    feasibilityResult = await storedFeasibility({ ...orderData, yarnTypeId, wastagePct });
  }

  const trackingToken = generateTrackingToken();
  const order = await withRetry(() =>
    writeTransaction(async (tx) => {
      const orderNo = await generateOrderNo(tx);
      return tx.order.create({
        data: { ...orderData, orderNo, trackingToken, status: "NEW", feasibilityResult },
      });
    }),
  );

  await logAudit("Order", order.id, "create", null, order, user.id);
  emit(RealtimeEvents.OrderStatus, { orderId: order.id, status: order.status });

  return NextResponse.json({ order }, { status: 201 });
}
