import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDispatchSchema } from "@/lib/validation/dispatch";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import { computeInvoiceTotals } from "@/lib/billing";
import { generateInvoiceNo } from "@/lib/order-numbers";


export async function GET(req: NextRequest) {
  const actor = await qualityActor();
  if ("response" in actor) return actor.response;
  try {
    const { searchParams } = new URL(req.url);
    const buyerId = searchParams.get("buyerId");

    const where: any = {};
    if (buyerId) where.buyerId = buyerId;

    const dispatches = await db.dispatch.findMany({
      where,
      include: {
        rolls: {
          include: {
            order: {
              include: { buyer: true },
            },
            machine: true,
            yarnLot: true,
          },
        },
      },
      orderBy: { dispatchedAt: "desc" },
    });

    return NextResponse.json(dispatches);
  } catch (err: any) {
    console.error("Failed to fetch dispatches:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const actor = await qualityActor("owner", "storekeeper");
  if ("response" in actor) return actor.response;
  try {
    const body = await req.json().catch(() => null);
    const parsed = createDispatchSchema.safeParse(body);

    if (!parsed.success) {
      return handleZodError(parsed.error);
    }

    const { buyerId, truckNo, rollIds } = parsed.data;

    // Verify buyer exists
    const buyer = await db.buyer.findUnique({
      where: { id: buyerId },
    });
    if (!buyer) {
      return NextResponse.json(
        { fieldErrors: { buyerId: "Specified buyer not found" } },
        { status: 400 }
      );
    }

    // Fetch all requested rolls
    const rolls = await db.roll.findMany({
      where: {
        id: { in: rollIds },
      },
      include: {
        order: true,
      },
    });

    if (rolls.length !== rollIds.length) {
      return NextResponse.json(
        { fieldErrors: { rollIds: "One or more selected rolls could not be found" } },
        { status: 400 }
      );
    }

    // 1. Enforce: A roll with a dispatchId can NEVER be dispatched again
    const alreadyDispatched = rolls.filter((r) => r.dispatchId !== null);
    if (alreadyDispatched.length > 0) {
      const rollNumbers = alreadyDispatched.map((r) => r.rollNo).join(", ");
      return NextResponse.json(
        {
          fieldErrors: {
            rollIds: `The following roll(s) have already been dispatched: ${rollNumbers}`,
          },
        },
        { status: 400 }
      );
    }

    // 2. Enforce: Only PASS rolls can be dispatched
    const nonPassRolls = rolls.filter((r) => r.qcStatus !== "PASS");
    if (nonPassRolls.length > 0) {
      const nonPassRollList = nonPassRolls
        .map((r) => `${r.rollNo} (${r.qcStatus})`)
        .join(", ");
      return NextResponse.json(
        {
          fieldErrors: {
            rollIds: `Only rolls with 'PASS' QC status can be dispatched. Found: ${nonPassRollList}`,
          },
        },
        { status: 400 }
      );
    }

    // 3. Enforce: All rolls must belong to orders for the specified buyer
    const mismatchedBuyerRolls = rolls.filter((r) => r.order.buyerId !== buyerId);
    if (mismatchedBuyerRolls.length > 0) {
      const mismatchedNumbers = mismatchedBuyerRolls.map((r) => r.rollNo).join(", ");
      return NextResponse.json(
        {
          fieldErrors: {
            buyerId: `The following rolls belong to a different buyer: ${mismatchedNumbers}`,
          },
        },
        { status: 400 }
      );
    }

    // Determine primary order for invoice linking
    const primaryOrder = rolls[0].order;

    // Link the order's GST invoice, creating it the way Module 1's
    // POST /api/invoices does (order qty × price, shared GST rate).
    let invoiceId: string | null = null;
    let invoice = await db.invoice.findFirst({
      where: { orderId: primaryOrder.id },
    });
    if (!invoice) {
      const subtotal = primaryOrder.qtyMetres * primaryOrder.pricePerMetre;
      const { gst, total } = computeInvoiceTotals(subtotal);
      invoice = await db.invoice.create({
        data: {
          invoiceNo: await generateInvoiceNo(),
          orderId: primaryOrder.id,
          buyerId,
          subtotal,
          gst,
          total,
          status: "ISSUED",
        },
      });
      await logAudit("Invoice", invoice.id, "create", null, invoice, actor.user.id);
    }
    invoiceId = invoice.id;

    // Atomically create Dispatch and mark all rolls with dispatchId
    const ordersDispatched: { id: string; from: string }[] = [];
    const dispatch = await db.$transaction(async (tx) => {
      const newDispatch = await tx.dispatch.create({
        data: {
          buyerId,
          truckNo,
          invoiceId,
        },
      });

      // Update all rolls (re-checking inside the transaction so two
      // concurrent dispatches can't both claim the same roll)
      const claimed = await tx.roll.updateMany({
        where: { id: { in: rollIds }, dispatchId: null, qcStatus: "PASS" },
        data: { dispatchId: newDispatch.id },
      });
      if (claimed.count !== rollIds.length) {
        throw new DispatchConflict();
      }

      // Update Order status to DISPATCHED once every roll that can still ship
      // has shipped (rejected rolls never ship, so they don't hold it back)
      const distinctOrderIds = Array.from(new Set(rolls.map((r) => r.orderId)));
      for (const ordId of distinctOrderIds) {
        const remainingUndispatched = await tx.roll.count({
          where: { orderId: ordId, dispatchId: null, qcStatus: { not: "REJECT" } },
        });
        const order = rolls.find((r) => r.orderId === ordId)!.order;
        if (remainingUndispatched === 0 && order.status !== "DISPATCHED" && order.status !== "CLOSED") {
          await tx.order.update({
            where: { id: ordId },
            data: { status: "DISPATCHED" },
          });
          ordersDispatched.push({ id: ordId, from: order.status });
        }
      }

      return newDispatch;
    });

    await logAudit(
      "Dispatch",
      dispatch.id,
      "DISPATCH_CREATED",
      null,
      { truckNo, buyerId, rollCount: rollIds.length, invoiceId },
      actor.user.id
    );
    for (const o of ordersDispatched) {
      await logAudit("Order", o.id, "status_change", { status: o.from }, { status: "DISPATCHED" }, actor.user.id);
      emit(RealtimeEvents.OrderStatus, { orderId: o.id, status: "DISPATCHED" });
    }

    emit(RealtimeEvents.DispatchCompleted, { dispatchId: dispatch.id, truckNo, rollCount: rollIds.length });
    emit(RealtimeEvents.StockChanged, {
      reason: "dispatch",
      rollCount: rollIds.length,
      truckNo,
    });

    const populatedDispatch = await db.dispatch.findUnique({
      where: { id: dispatch.id },
      include: {
        rolls: {
          include: {
            order: true,
            machine: true,
          },
        },
      },
    });

    return NextResponse.json(populatedDispatch, { status: 201 });
  } catch (err: any) {
    if (err instanceof DispatchConflict) {
      return NextResponse.json(
        { fieldErrors: { rollIds: "One or more rolls were dispatched or re-inspected by someone else. Refresh and try again." } },
        { status: 400 }
      );
    }
    console.error("Failed to process dispatch:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

class DispatchConflict extends Error {}
