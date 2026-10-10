import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDispatchSchema } from "@/lib/validation/dispatch";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emitRealtime } from "@/lib/realtime";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
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
  try {
    const body = await req.json();
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
    const totalMetres = rolls.reduce((acc, r) => acc + r.lengthMetres, 0);

    // Call Module 1's invoice endpoint or create/link invoice
    let invoiceId: string | null = null;
    try {
      // Check if an invoice already exists for this order
      let invoice = await db.invoice.findFirst({
        where: { orderId: primaryOrder.id },
      });

      if (!invoice) {
        // Generate GST invoice (18% GST as per Indian textiles spec)
        const count = await db.invoice.count();
        const datePrefix = new Date().toISOString().slice(2, 7).replace("-", "");
        const invoiceNo = `INV-${datePrefix}-${String(count + 1).padStart(4, "0")}`;
        const subtotal = totalMetres * primaryOrder.pricePerMetre;
        const gst = subtotal * 0.18; // 18% GST
        const total = subtotal + gst;

        invoice = await db.invoice.create({
          data: {
            invoiceNo,
            orderId: primaryOrder.id,
            buyerId,
            subtotal,
            gst,
            total,
            status: "ISSUED",
          },
        });
      }
      invoiceId = invoice.id;
    } catch (invErr) {
      console.warn("Invoice linking note:", invErr);
    }

    // Atomically create Dispatch and mark all rolls with dispatchId
    const dispatch = await db.$transaction(async (tx) => {
      const newDispatch = await tx.dispatch.create({
        data: {
          buyerId,
          truckNo,
          invoiceId,
        },
      });

      // Update all rolls
      await tx.roll.updateMany({
        where: { id: { in: rollIds } },
        data: { dispatchId: newDispatch.id },
      });

      // Update Order status to DISPATCHED if all rolls of order are dispatched
      const distinctOrderIds = Array.from(new Set(rolls.map((r) => r.orderId)));
      for (const ordId of distinctOrderIds) {
        const remainingUndispatched = await tx.roll.count({
          where: { orderId: ordId, dispatchId: null },
        });
        if (remainingUndispatched === 0) {
          await tx.order.update({
            where: { id: ordId },
            data: { status: "DISPATCHED" },
          });
          emitRealtime("order:status", { orderId: ordId, status: "DISPATCHED" });
        }
      }

      return newDispatch;
    });

    await logAudit(
      "Dispatch",
      dispatch.id,
      "DISPATCH_CREATED",
      null,
      { truckNo, buyerId, rollCount: rollIds.length, invoiceId }
    );

    emitRealtime("stock:changed", {
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
    console.error("Failed to process dispatch:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
