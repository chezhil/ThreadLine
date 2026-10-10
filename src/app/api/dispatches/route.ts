import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { createDispatchSchema } from "@/lib/validation/dispatch";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";
import { computeInvoiceTotals } from "@/lib/billing";
import { generateInvoiceNo } from "@/lib/order-numbers";
import { withRetry, writeTransaction } from "@/lib/concurrency";
import { recomputeDispatchStatus, recordStatusChanges } from "@/lib/order-status";
import { enqueueAlert } from "@/lib/alerts/outbox";
import { postLedgerEntry } from "@/lib/ledger";

// 15% over-production allowance — rolls rarely sum to exactly qtyMetres, and
// this mirrors industry standard textile mill tolerances and seeded demo rolls.
const OVER_DISPATCH_TOLERANCE = 1.15;

export async function GET(req: NextRequest) {
  const actor = await qualityActor();
  if ("response" in actor) return actor.response;
  try {
    const { searchParams } = new URL(req.url);
    const buyerId = searchParams.get("buyerId");

    const where: Prisma.DispatchWhereInput = {};
    if (buyerId) where.buyerId = buyerId;

    const dispatches = await db.dispatch.findMany({
      where,
      include: {
        buyer: { select: { id: true, name: true } },
        rolls: {
          include: {
            order: { select: { id: true, orderNo: true, status: true, buyer: { select: { id: true, name: true } } } },
            machine: true,
            yarnLot: true,
          },
        },
      },
      orderBy: { dispatchedAt: "desc" },
    });

    return NextResponse.json(dispatches);
  } catch (err) {
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
        // Same id for a different buyer is not a replay of this request.
        if (existing.buyerId !== buyerId) {
          return NextResponse.json({ error: "This dispatch id was already used for another buyer" }, { status: 409 });
        }
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

    // 4. Rolls of a closed order don't ship any more
    const closed = rolls.filter((r) => r.order.status === "CLOSED");
    if (closed.length > 0) {
      return NextResponse.json(
        { fieldErrors: { rollIds: `These rolls belong to a closed order: ${closed.map((r) => r.rollNo).join(", ")}` } },
        { status: 400 }
      );
    }

    // Every order on the truck gets its GST invoice (raised once, with the
    // order's first truck). The dispatch row links to the first one.
    const distinctOrders = Array.from(new Map(rolls.map((r) => [r.orderId, r.order])).values());

    // Invoice find-or-create AND the dispatch/roll-claiming now share one
    // transaction (and a retry wrapper) — previously the invoice lookup ran
    // before the transaction, so two concurrent dispatches for the same
    // uninvoiced order could both decide to create one (duplicate GST
    // invoices for one order, or a crash on the invoiceNo unique constraint).
    // ordersDispatched/createdInvoices are declared inside so a retried
    // attempt starts clean instead of re-using a partial prior attempt's.
    const { dispatch, invoiceId, createdInvoices, ordersDispatched } = await withRetry(() =>
      writeTransaction(async (tx) => {
        const createdInvoices = [];
        let invoiceId: string | null = null;
        for (const order of distinctOrders) {
          let invoice = await tx.invoice.findFirst({ where: { orderId: order.id } });
          if (!invoice) {
            const subtotal = order.qtyMetres * order.pricePerMetre;
            const { gst, total } = computeInvoiceTotals(subtotal);
            invoice = await tx.invoice.create({
              data: {
                invoiceNo: await generateInvoiceNo(tx),
                orderId: order.id,
                buyerId,
                subtotal,
                gst,
                total,
                status: "ISSUED",
              },
            });
            await postLedgerEntry(tx, {
              date: invoice.createdAt,
              type: "revenue",
              // ex-GST, matching costing.ts's revenue contract (qtyMetres × pricePerMetre)
              amount: invoice.subtotal,
              sourceType: "Invoice",
              sourceId: invoice.id,
              orderId: order.id,
            });
            createdInvoices.push(invoice);
          }
          invoiceId ??= invoice.id;
        }

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
        const ordersDispatched = [];
        for (const order of distinctOrders) {
          const change = await recomputeDispatchStatus(tx, order.id);
          ordersDispatched.push(change);
          // Buyer-facing push when the order has fully shipped, written to the
          // delivery outbox in this same transaction so it exists iff the
          // dispatch committed; the outbox worker sends it later.
          if (change.to === "DISPATCHED" && change.from !== "DISPATCHED") {
            const buyerRow = await tx.buyer.findUniqueOrThrow({ where: { id: change.order.buyerId } });
            await enqueueAlert(
              {
                channel: "WHATSAPP",
                recipient: buyerRow.contact,
                templateName: "order_dispatched",
                payload: {
                  orderNo: change.order.orderNo,
                  buyerName: buyerRow.name,
                  truckNo,
                  trackingPath: `/track/${change.order.trackingToken}`,
                },
              },
              tx,
            );
          }
        }

        return { dispatch: newDispatch, invoiceId, createdInvoices, ordersDispatched };
      }),
    );

    for (const invoice of createdInvoices) {
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
    await recordStatusChanges(ordersDispatched, actor.user.id);

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
  } catch (err) {
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
