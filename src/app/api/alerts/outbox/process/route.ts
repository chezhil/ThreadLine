import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireRole } from "@/lib/auth";
import { processAlertOutbox } from "@/lib/alerts/outbox";

// POST — drains due PENDING/RETRYING AlertDelivery rows. Separate from the
// write that enqueues them (order READY / DISPATCHED) on purpose: a failed
// send must never block or roll back the event that raised it (HARDENING_
// ADDENDUM.md item 6). Safe to call repeatedly — rows not yet due for retry
// (exponential backoff) are left alone. Callers: the owner "Process now"
// button (session), and server.js's built-in drain timer, which has no session
// and proves itself with the shared ALERT_WORKER_TOKEN instead. The path is
// public in proxy.ts, so this route does all the authorising.
function hasWorkerToken(req: NextRequest) {
  const expected = process.env.ALERT_WORKER_TOKEN;
  const given = req.headers.get("x-worker-token");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!hasWorkerToken(req)) {
    const user = await requireRole("owner");
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await processAlertOutbox();
  return NextResponse.json(result);
}
