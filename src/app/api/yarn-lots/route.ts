import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { yarnLotSchema } from "@/lib/validation/yarn";
import { logAudit } from "@/lib/audit";
import { checkLowStockAndNotify } from "@/lib/inventory";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";

export async function GET() {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const lots = await db.yarnLot.findMany({
    include: { yarnType: true, supplier: true, _count: { select: { reservations: true, rolls: true } } },
    orderBy: { receivedAt: "desc" },
  });
  // linkedOrderId is a plain column (no relation), so resolve order numbers here.
  const linkedIds = [...new Set(lots.map((l) => l.linkedOrderId).filter((v): v is string => !!v))];
  const orders = linkedIds.length
    ? await db.order.findMany({ where: { id: { in: linkedIds } }, select: { id: true, orderNo: true } })
    : [];
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]));
  const yarnLots = lots.map((l) => ({ ...l, linkedOrderNo: l.linkedOrderId ? (orderNo.get(l.linkedOrderId) ?? null) : null }));
  return NextResponse.json({ yarnLots });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const parsed = yarnLotSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const { yarnTypeId, supplierId, lotNo, qtyReceivedKg, receivedAt, linkedOrderId } = parsed.data;

  const [yarnType, supplier, linkedOrder, duplicate] = await Promise.all([
    db.yarnType.findUnique({ where: { id: yarnTypeId } }),
    db.supplier.findUnique({ where: { id: supplierId } }),
    linkedOrderId ? db.order.findUnique({ where: { id: linkedOrderId }, select: { id: true, status: true } }) : null,
    db.yarnLot.findFirst({ where: { lotNo, supplierId }, select: { id: true } }),
  ]);
  if (!yarnType) return fieldErrorResponse({ yarnTypeId: ["Yarn type not found"] });
  if (yarnType.archivedAt) return fieldErrorResponse({ yarnTypeId: ["This yarn type is archived; restore it first"] });
  if (!supplier) return fieldErrorResponse({ supplierId: ["Supplier not found"] });
  if (supplier.archivedAt) return fieldErrorResponse({ supplierId: ["This supplier is archived; restore it first"] });
  if (linkedOrderId && !linkedOrder) return fieldErrorResponse({ linkedOrderId: ["Order not found"] });
  if (linkedOrder?.status === "CLOSED") return fieldErrorResponse({ linkedOrderId: ["That order is closed"] });
  if (duplicate) return fieldErrorResponse({ lotNo: [`Lot ${lotNo} from ${supplier.name} is already recorded`] }, 409);

  const yarnLot = await db.yarnLot.create({
    data: {
      yarnTypeId,
      supplierId,
      lotNo,
      qtyReceivedKg,
      qtyRemainingKg: qtyReceivedKg,
      receivedAt,
      linkedOrderId,
    },
  });

  await logAudit("YarnLot", yarnLot.id, "intake", null, yarnLot, user.id);
  await checkLowStockAndNotify(yarnTypeId);

  return NextResponse.json({ yarnLot }, { status: 201 });
}
