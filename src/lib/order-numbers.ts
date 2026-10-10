import { randomUUID } from "crypto";
import { db } from "./db";

export async function generateOrderNo(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const count = await db.order.count();
  const seq = String(count + 1).padStart(3, "0");
  return `EVR-${yy}${mm}-${seq}`;
}

export function generateTrackingToken(): string {
  return randomUUID().replace(/-/g, "");
}

export async function generateInvoiceNo(): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const count = await db.invoice.count();
  const seq = String(count + 1).padStart(4, "0");
  return `INV-${yy}${mm}-${seq}`;
}
