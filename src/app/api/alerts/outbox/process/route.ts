import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { processAlertOutbox } from "@/lib/alerts/outbox";

// POST — drains due PENDING/RETRYING AlertDelivery rows. Separate from the
// write that enqueues them (order READY / DISPATCHED) on purpose: a failed
// send must never block or roll back the event that raised it (HARDENING_
// ADDENDUM.md item 6). Safe to call repeatedly — rows not yet due for retry
// (exponential backoff) are left alone. `scripts/alert-worker.ts` polls this
// path automatically; this endpoint also backs an owner "Process now" button.
export async function POST() {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await processAlertOutbox();
  return NextResponse.json(result);
}
