import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { orderCreateSchema } from "@/lib/validation/order";
import { generateOrderNo, generateTrackingToken } from "@/lib/order-numbers";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { withRetry, writeTransaction } from "@/lib/concurrency";
import { storedFeasibility } from "@/lib/feasibility";
import { parsePageParams } from "@/lib/pagination";
import { ORDER_STATUSES } from "@/lib/tokens";

// Lower = more urgent. CLOSED/DISPATCHED orders have nothing left to chase,
// so they always sort after anything still open — regardless of deadline —
// and amongst themselves newest-first (most recently finished on top).
const URGENCY_RANK: Record<string, number> = { DISPATCHED: 1, CLOSED: 2 };
function urgencyRank(status: string) {
  return URGENCY_RANK[status] ?? 0;
}

export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const sort = sp.get("sort") ?? "urgency";
  const statusParam = sp.get("status");
  const buyerId = sp.get("buyerId");
  const q = sp.get("q")?.trim();
  const { paginated, page, pageSize, skip, take } = parsePageParams(sp);

  const statuses = statusParam
    ? statusParam.split(",").filter((s): s is (typeof ORDER_STATUSES)[number] => (ORDER_STATUSES as readonly string[]).includes(s))
    : null;

  const where: Prisma.OrderWhereInput = {
    ...(statuses && statuses.length ? { status: { in: statuses } } : {}),
    ...(buyerId ? { buyerId } : {}),
    ...(q
      ? {
          OR: [
            { orderNo: { contains: q, mode: "insensitive" } },
            { fabricType: { contains: q, mode: "insensitive" } },
            { colour: { contains: q, mode: "insensitive" } },
            { status: { contains: q, mode: "insensitive" } },
            { buyer: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  // Pickers ("link this expense to an order") need only a label per order,
  // not the full rows — a few KB instead of hundreds at 500+ orders.
  if (sp.get("view") === "options") {
    const options = await db.order.findMany({
      where,
      select: { id: true, orderNo: true, buyer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ orders: options });
  }

  const total = await db.order.count({ where });

  // Urgency needs a bucket (open orders before done ones) then a tiebreak —
  // not a plain column order — so it's resolved in two lightweight steps:
  // rank just id/deadline/status for every matching order (cheap even at
  // thousands of rows), sort/slice in memory, then hydrate only the page's
  // rows with the full buyer join.
  let orderedIds: string[] | null = null;
  if (sort === "urgency") {
    const slim = await db.order.findMany({ where, select: { id: true, deadline: true, status: true } });
    slim.sort((a, b) => {
      const rankDiff = urgencyRank(a.status) - urgencyRank(b.status);
      if (rankDiff !== 0) return rankDiff;
      // Open orders: soonest/most-overdue deadline first. Done orders: most
      // recently finished first (there's no "deadline" left to chase).
      return urgencyRank(a.status) === 0 ? a.deadline.getTime() - b.deadline.getTime() : b.deadline.getTime() - a.deadline.getTime();
    });
    orderedIds = slim.map((o) => o.id);
  }

  const orderBy: Prisma.OrderOrderByWithRelationInput =
    sort === "deadline"
      ? { deadline: "asc" }
      : sort === "value"
        ? { qtyMetres: "desc" }
        : { createdAt: "desc" }; // "newest" and the fallback for "urgency" (ids already ranked)

  let orders;
  if (orderedIds) {
    const pageIds = paginated ? orderedIds.slice(skip, skip + take) : orderedIds;
    const rows = await db.order.findMany({ where: { id: { in: pageIds } }, include: { buyer: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    orders = pageIds.map((id) => byId.get(id)!).filter(Boolean);
  } else {
    orders = await db.order.findMany({
      where,
      include: { buyer: true },
      orderBy,
      ...(paginated ? { skip, take } : {}),
    });
  }

  return NextResponse.json({ orders, total, page, pageSize });
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
