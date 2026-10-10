import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { orderStatusUpdateSchema } from "@/lib/validation/order";
import { applyClose, applyConfirm, InvalidTransition } from "@/lib/order-status";

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

// Only NEW->CONFIRMED and DISPATCHED->CLOSED are set by a person clicking a
// button — everything in between (IN_PRODUCTION, QC, READY, DISPATCHED) is
// computed from real production/QC/dispatch events (see
// src/lib/order-status.ts) and can't be requested here. That used to be
// possible: this endpoint used to accept any next status in sequence, which
// meant an owner could "Advance" an order straight to READY or DISPATCHED
// from the UI with zero rolls actually produced, inspected, or shipped.
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

  const { status: to } = parsed.data;
  if (to !== "CONFIRMED" && to !== "CLOSED") {
    return NextResponse.json(
      {
        fieldErrors: {
          status: [
            to === "IN_PRODUCTION"
              ? "IN_PRODUCTION is set automatically when production starts a work order, not set manually."
              : to === "QC"
                ? "QC is set automatically once every production stage completes, not set manually."
                : to === "READY"
                  ? "READY is set automatically once QC passes, not set manually."
                  : to === "DISPATCHED"
                    ? "DISPATCHED is set automatically once every shippable roll has been dispatched, not set manually."
                    : `Only CONFIRMED or CLOSED can be set here.`,
          ],
        },
      },
      { status: 400 },
    );
  }

  const exists = await db.order.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const updated = to === "CONFIRMED" ? await applyConfirm(id, user.id) : await applyClose(id, user.id);
    return NextResponse.json({ order: updated });
  } catch (e) {
    if (e instanceof InvalidTransition) {
      return NextResponse.json({ fieldErrors: { status: [e.message] } }, { status: 400 });
    }
    throw e;
  }
}
