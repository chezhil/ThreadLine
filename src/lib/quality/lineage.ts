import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Whether a roll of `orderId` may be made from this yarn lot: the lot was
 * reserved for the order, received against it, or — for orders seeded or
 * started before reservations were enforced — already used by the order's
 * earlier rolls. Roll minting and roll edits both check it.
 */
export async function lotServesOrder(client: Db, yarnLotId: string, orderId: string): Promise<"ok" | "missing" | "foreign"> {
  const lot = await client.yarnLot.findUnique({
    where: { id: yarnLotId },
    include: { reservations: { select: { orderId: true } } },
  });
  if (!lot) return "missing";
  if (lot.linkedOrderId === orderId || lot.reservations.some((r) => r.orderId === orderId)) return "ok";
  return (await client.roll.count({ where: { orderId, yarnLotId } })) > 0 ? "ok" : "foreign";
}
