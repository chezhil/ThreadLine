// One-off backfill: orders already seeded (before seed-bulk.ts started writing
// its own AuditLog rows) have no audit history, so the Audit Trail page has
// nothing to show. Reads every Order with zero AuditLog rows and inserts a
// plausible status_change chain from NEW up to its current status.
import { PrismaClient, Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

const db = new PrismaClient();

const CHAIN: Record<string, string[]> = {
  NEW: [],
  CONFIRMED: ["CONFIRMED"],
  IN_PRODUCTION: ["CONFIRMED", "IN_PRODUCTION"],
  QC: ["CONFIRMED", "IN_PRODUCTION", "QC"],
  READY: ["CONFIRMED", "IN_PRODUCTION", "QC", "READY"],
  DISPATCHED: ["CONFIRMED", "IN_PRODUCTION", "QC", "READY", "DISPATCHED"],
  CLOSED: ["CONFIRMED", "IN_PRODUCTION", "QC", "READY", "DISPATCHED", "CLOSED"],
};

async function main() {
  const owner = await db.user.findFirst({ where: { role: "owner" } });
  if (!owner) throw new Error("No owner user found.");

  const withAudit = new Set((await db.auditLog.findMany({ where: { entity: "Order" }, select: { entityId: true } })).map((a) => a.entityId));
  const orders = await db.order.findMany({ select: { id: true, status: true, createdAt: true } });
  const missing = orders.filter((o) => !withAudit.has(o.id));

  const rows: Prisma.AuditLogCreateManyInput[] = [];
  const now = Date.now();
  for (const o of missing) {
    const chain = CHAIN[o.status] ?? [];
    if (!chain.length) continue;
    const span = Math.max(1, now - o.createdAt.getTime());
    let prev = "NEW";
    chain.forEach((next, idx) => {
      rows.push({
        id: randomUUID(),
        entity: "Order",
        entityId: o.id,
        action: "status_change",
        oldValue: JSON.stringify({ status: prev }),
        newValue: JSON.stringify({ status: next }),
        userId: owner.id,
        at: new Date(o.createdAt.getTime() + (span * (idx + 1)) / (chain.length + 1)),
      });
      prev = next;
    });
  }

  for (let i = 0; i < rows.length; i += 500) {
    await db.auditLog.createMany({ data: rows.slice(i, i + 500) });
  }
  console.log(`Backfilled ${rows.length} audit row(s) for ${missing.length} order(s) that had none.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
