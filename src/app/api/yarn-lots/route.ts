import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { yarnLotSchema } from "@/lib/validation/yarn";
import { logAudit } from "@/lib/audit";
import { checkLowStockAndNotify } from "@/lib/inventory";
import { istDateKey } from "@/lib/accounts/period";

export async function GET() {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const yarnLots = await db.yarnLot.findMany({
    include: { yarnType: true, supplier: true },
    orderBy: { receivedAt: "desc" },
  });
  return NextResponse.json({ yarnLots });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = yarnLotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { yarnTypeId, supplierId, lotNo, qtyReceivedKg, receivedAt, linkedOrderId } = parsed.data;

  const [yarnType, supplier, linkedOrder] = await Promise.all([
    db.yarnType.findUnique({ where: { id: yarnTypeId } }),
    db.supplier.findUnique({ where: { id: supplierId } }),
    linkedOrderId ? db.order.findUnique({ where: { id: linkedOrderId }, select: { id: true, status: true } }) : null,
  ]);
  if (!yarnType) {
    return NextResponse.json({ fieldErrors: { yarnTypeId: ["Yarn type not found"] } }, { status: 400 });
  }
  if (!supplier) {
    return NextResponse.json({ fieldErrors: { supplierId: ["Supplier not found"] } }, { status: 400 });
  }
  if (linkedOrderId && !linkedOrder) {
    return NextResponse.json({ fieldErrors: { linkedOrderId: ["Order not found"] } }, { status: 400 });
  }
  if (linkedOrder?.status === "CLOSED") {
    return NextResponse.json({ fieldErrors: { linkedOrderId: ["That order is closed"] } }, { status: 400 });
  }
  // Goods can't arrive in the future (compared as mill dates, IST).
  if (istDateKey(receivedAt) > istDateKey(new Date())) {
    return NextResponse.json({ fieldErrors: { receivedAt: ["Received date can't be in the future"] } }, { status: 400 });
  }

  const yarnLot = await db.yarnLot.create({
    data: {
      yarnTypeId,
      supplierId,
      lotNo,
      qtyReceivedKg,
      qtyRemainingKg: qtyReceivedKg,
      receivedAt,
      linkedOrderId: linkedOrderId ?? null,
    },
  });

  await logAudit("YarnLot", yarnLot.id, "intake", null, yarnLot, user.id);
  await checkLowStockAndNotify(yarnTypeId);

  return NextResponse.json({ yarnLot }, { status: 201 });
}
