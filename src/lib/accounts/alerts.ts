import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "../db";
import { emit, RealtimeEvents } from "../realtime";
import { writeTransaction } from "../concurrency";

// Server side of the notification centre. Any module may insert into
// Notification; this file adds the two alert kinds from the spec that no
// write path raises on its own (machine breakdown, order ready), derived from
// current machine/order state each time the alert list is read.
//
// Each derived alert's `type` carries the entity id so it is raised once per
// episode. When the condition clears, the open alert is marked read and its
// type is suffixed `:cleared:<ts>`, so the next breakdown of the same machine
// raises a fresh alert instead of being swallowed by the old one.

interface Condition {
  type: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

async function currentConditions(db: PrismaClient): Promise<Condition[]> {
  const [broken, ready] = await Promise.all([
    db.machine.findMany({ where: { status: "BREAKDOWN" }, select: { id: true, name: true } }),
    db.order.findMany({
      where: { status: "READY" },
      select: {
        id: true,
        orderNo: true,
        qtyMetres: true,
        buyer: { select: { name: true } },
        rolls: { where: { qcStatus: "PASS", dispatchId: null }, select: { lengthMetres: true } },
      },
    }),
  ]);
  return [
    ...broken.map((m) => ({
      type: `machine_breakdown:${m.id}`,
      message: `${m.name} is down (BREAKDOWN). Work orders on it are stalled until it is repaired.`,
      severity: "critical" as const,
    })),
    ...ready.map((o) => {
      const metres = o.rolls.reduce((s, r) => s + r.lengthMetres, 0);
      const rolls = o.rolls.length;
      return {
        type: `order_ready:${o.id}`,
        message: `${o.orderNo} for ${o.buyer.name} is READY for dispatch${
          rolls ? ` — ${rolls} passed roll${rolls === 1 ? "" : "s"}, ${Math.round(metres)} m of ${o.qtyMetres} m.` : "."
        }`,
        severity: "info" as const,
      };
    }),
  ];
}

const DERIVED_PREFIXES = ["machine_breakdown:", "order_ready:"];

export async function syncDerivedAlerts(db: PrismaClient = defaultDb) {
  const conditions = await currentConditions(db);
  const live = new Set(conditions.map((c) => c.type));

  // Concurrent callers (e.g. two tabs polling GET /api/alerts at once) must
  // not both observe "no open alert yet" and both insert one — read the open
  // set and create any missing ones inside the same transaction, so SQLite
  // serialises the two calls instead of racing them (same pattern as the
  // concurrency-safety pass: see ../concurrency.ts and HARDENING_ADDENDUM.md).
  const created = await writeTransaction(db, async (tx) => {
    const open = await tx.notification.findMany({
      where: {
        OR: DERIVED_PREFIXES.map((p) => ({ type: { startsWith: p } })),
        NOT: { type: { contains: ":cleared:" } },
      },
      select: { id: true, type: true },
    });
    const existing = new Set(open.map((n) => n.type));

    for (const n of open) {
      if (!live.has(n.type)) {
        await tx.notification.update({
          where: { id: n.id },
          data: { read: true, type: `${n.type}:cleared:${Date.now()}` },
        });
      }
    }
    const newlyCreated = [];
    for (const c of conditions) {
      if (existing.has(c.type)) continue;
      newlyCreated.push(await tx.notification.create({ data: c }));
    }
    return newlyCreated;
  });
  for (const n of created) emit(RealtimeEvents.NotificationNew, n);
}

/** Raise a one-off notification and push it to every open screen. */
export async function notify(
  type: string,
  message: string,
  severity: "info" | "warning" | "critical",
  db: PrismaClient = defaultDb,
) {
  const created = await db.notification.create({ data: { type, message, severity } });
  emit(RealtimeEvents.NotificationNew, created);
  return created;
}
