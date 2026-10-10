import { randomUUID } from "crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "./db";

// Accepts either the top-level client or an interactive-transaction client.
// Count-then-format is a count-then-write race if two requests do it against
// the top-level client at the same time — the caller MUST invoke this from
// inside a `db.$transaction(async (tx) => ...)` and pass `tx`, so the
// count and the create it feeds happen in the same SQLite write transaction.
// Calling it without a tx (the default) is only safe for seed scripts and
// anything else that can't race itself.
type Db = PrismaClient | Prisma.TransactionClient;

export async function generateOrderNo(tx: Db = db): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const count = await tx.order.count();
  const seq = String(count + 1).padStart(3, "0");
  return `EVR-${yy}${mm}-${seq}`;
}

export function generateTrackingToken(): string {
  return randomUUID().replace(/-/g, "");
}

export async function generateInvoiceNo(tx: Db = db): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const count = await tx.invoice.count();
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${yy}${mm}-${seq}`;
}
