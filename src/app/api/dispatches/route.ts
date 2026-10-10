import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createDispatchSchema } from "@/lib/validation/dispatch";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import { computeInvoiceTotals } from "@/lib/billing";
import { generateInvoiceNo } from "@/lib/order-numbers";
import { withRetry } from "@/lib/concurrency";
import { recomputeDispatchStatus } from "@/lib/order-status";
import { enqueueAlert } from "@/lib/alerts/outbox";
import { postLedgerEntry } from "@/lib/ledger";

// 5% over-production allowance — rolls rarely sum to exactly qtyMetres, and
// this mirrors the wastage tolerance costing/feasibility already use.
const OVER_DISPATCH_TOLERANCE = 1.05;

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

    const { buyerId, truckNo, rollIds, clientMutationId } = parsed.data;

    // Idempotency check for offline replay
    if (clientMutationId) {
      const existing = await db.dispatch.findUnique({
        where: { id: clientMutationId },
        include: {
          rolls: {
            include: {
              order: true,
              machine: true,
            },
          },
        },
      });
      if (existing) {
        return NextResponse.json(existing, { status: 200 });
      }
    }

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

    // Invoice find-or-create AND the dispatch/roll-claiming now share one
    // transaction (and a retry wrapper) — previously the invoice lookup ran
    // before the transaction, so two concurrent dispatches for the same
    // uninvoiced order could both decide to create one (duplicate GST
    // invoices for one order, or a crash on the invoiceNo unique constraint).
    // ordersDispatched/invoiceCreated are declared inside so a retried
    // attempt starts clean instead of re-using a partial prior attempt's.
    const { dispatch, invoiceId, invoice, invoiceCreated, ordersDispatched } = await withRetry(() =>
      db.$transaction(async (tx) => {
        let invoice = await tx.invoice.findFirst({ where: { orderId: primaryOrder.id } });
        let invoiceCreated = false;
        if (!invoice) {
          const subtotal = primaryOrder.qtyMetres * primaryOrder.pricePerMetre;
          const { gst, total } = computeInvoiceTotals(subtotal);
          invoice = await tx.invoice.create({
            data: {
              invoiceNo: await generateInvoiceNo(tx),
              orderId: primaryOrder.id,
              buyerId,
              subtotal,
              gst,
              total,
              status: "ISSUED",
            },
          });
          invoiceCreated = true;
          await postLedgerEntry(tx, {
            date: invoice.createdAt,
            type: "revenue",
            // ex-GST, matching costing.ts's revenue contract (qtyMetres × pricePerMetre)
            amount: invoice.subtotal,
            sourceType: "Invoice",
            sourceId: invoice.id,
            orderId: primaryOrder.id,
          });
        }
        const invoiceId = invoice.id;

        // Guard: a batch that would ship more than an order's qtyMetres
        // (allowing a small over-production tolerance, same idea as the
        // process-wastage allowance elsewhere) is rejected rather than
        // silently shipped — production over-producing shouldn't let
        // dispatch quietly exceed what the buyer ordered.
        for (const ordId of new Set(rolls.map((r) => r.orderId))) {
          const order = rolls.find((r) => r.orderId === ordId)!.order;
          const alreadyAgg = await tx.roll.aggregate({
            where: { orderId: ordId, dispatchId: { not: null } },
            _sum: { lengthMetres: true },
          });
          const alreadyMetres = alreadyAgg._sum.lengthMetres ?? 0;
          const batchMetres = rolls
            .filter((r) => r.orderId === ordId)
            .reduce((s, r) => s + r.lengthMetres, 0);
          const wouldBeMetres = alreadyMetres + batchMetres;
          const limit = order.qtyMetres * OVER_DISPATCH_TOLERANCE;
          if (wouldBeMetres > limit + 0.01) {
            throw new OverDispatchError(order.orderNo, wouldBeMetres, order.qtyMetres);
          }
        }

        const newDispatch = await tx.dispatch.create({
          data: {
            id: clientMutationId || undefined,
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

        // Recompute dispatchStatus (and the derived legacy `status`) for
        // every order touched — NOT_DISPATCHED/PARTIALLY_DISPATCHED/
        // FULLY_DISPATCHED from the real roll rows, so a buyer taking half an
        // order first is represented, not just the all-shipped end state.
        const ordersDispatched: { id: string; from: string; to: string }[] = [];
        const distinctOrderIds = Array.from(new Set(rolls.map((r) => r.orderId)));
        for (const ordId of distinctOrderIds) {
          const order = rolls.find((r) => r.orderId === ordId)!.order;
          if (order.status === "CLOSED") continue; // terminal, never reopened by a dispatch
          const { from, to } = await recomputeDispatchStatus(tx, ordId);
          if (from !== to) ordersDispatched.push({ id: ordId, from, to });
        }

        return { dispatch: newDispatch, invoiceId, invoice, invoiceCreated, ordersDispatched };
      }),
    );

    if (invoiceCreated) {
      await logAudit("Invoice", invoice.id, "create", null, invoice, actor.user.id);
    }
    await logAudit(
      "Dispatch",
      dispatch.id,
      "DISPATCH_CREATED",
      null,
      { truckNo, buyerId, rollCount: rollIds.length, invoiceId },
      actor.user.id
    );
    for (const o of ordersDispatched) {
      await logAudit("Order", o.id, "status_change", { status: o.from }, { status: o.to }, actor.user.id);
      emit(RealtimeEvents.OrderStatus, { orderId: o.id, status: o.to });
      if (o.to === "DISPATCHED") {
        const orderWithBuyer = await db.order.findUnique({ where: { id: o.id }, include: { buyer: true } });
        if (orderWithBuyer) {
          await enqueueAlert({
            channel: "WHATSAPP",
            recipient: orderWithBuyer.buyer.contact,
            templateName: "order_dispatched",
            payload: {
              orderNo: orderWithBuyer.orderNo,
              buyerName: orderWithBuyer.buyer.name,
              truckNo,
              trackingPath: `/track/${orderWithBuyer.trackingToken}`,
            },
          });
        }
      }
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
    if (err instanceof OverDispatchError) {
      return NextResponse.json(
        {
          fieldErrors: {
            rollIds: `This would ship ${err.wouldBeMetres.toFixed(1)}m against ${err.orderNo}'s ordered ${err.orderedMetres}m — check which rolls belong to this order.`,
          },
        },
        { status: 400 }
      );
    }
    console.error("Failed to process dispatch:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

class DispatchConflict extends Error {}

class OverDispatchError extends Error {
  constructor(
    public orderNo: string,
    public wouldBeMetres: number,
    public orderedMetres: number,
  ) {
    super(`Over-dispatch for ${orderNo}`);
  }
}
