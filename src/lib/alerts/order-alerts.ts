import type { Prisma } from "@prisma/client";
import type { StatusChange } from "@/lib/order-status";
import { enqueueAlert } from "./outbox";

/**
 * Buyer-facing push when an order has just become READY (an inspection, a
 * reversed inspection or a removed pending roll can each do it). Written to
 * the delivery outbox in the caller's transaction, so it exists iff that write
 * commits, and sent later by the outbox worker — a failed send never blocks or
 * re-runs the write (HARDENING_ADDENDUM.md item 6).
 */
export async function queueOrderReadyAlert(tx: Prisma.TransactionClient, change: StatusChange | null) {
  if (!change || change.to !== "READY" || change.from === "READY") return;
  const order = await tx.order.findUniqueOrThrow({ where: { id: change.orderId }, include: { buyer: true } });
  await enqueueAlert(
    {
      channel: "WHATSAPP",
      recipient: order.buyer.contact,
      templateName: "order_ready",
      payload: { orderNo: order.orderNo, buyerName: order.buyer.name, trackingPath: `/track/${order.trackingToken}` },
    },
    tx,
  );
}
