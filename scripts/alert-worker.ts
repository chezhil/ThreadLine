// Standalone delivery worker for the AlertDelivery outbox (HARDENING_
// ADDENDUM.md item 6). Run alongside `npm run dev` with `npm run alerts:worker`
// to have queued WhatsApp/SMS/email alerts actually drain with retry/backoff
// instead of sitting PENDING until someone clicks "Process now" in the UI.
//
// Deliberately a separate process, not something `server.js` calls inline:
// the whole point of an outbox is that a failed send can never block or
// unwind the write (order READY / DISPATCHED) that queued it.
import { processAlertOutbox } from "../src/lib/alerts/outbox";

const POLL_INTERVAL_MS = Number(process.env.ALERT_WORKER_INTERVAL_MS ?? 10_000);

async function tick() {
  try {
    const result = await processAlertOutbox();
    if (result.processed > 0) {
      const ts = new Date().toISOString();
      console.log(
        `[${ts}] alert-worker: processed=${result.processed} sent=${result.sent} retried=${result.retried} failed=${result.failed}`,
      );
    }
  } catch (err) {
    console.error("alert-worker: tick failed", err);
  }
}

console.log(`alert-worker: polling every ${POLL_INTERVAL_MS}ms (Ctrl+C to stop)`);
tick();
setInterval(tick, POLL_INTERVAL_MS);
