// HARDENING_ADDENDUM.md item 5, row 5: "Offline QC entry that conflicts on
// sync ... needs a scripted test that writes a conflicting server-side
// change, then replays a queued client write, and asserts it's flagged
// rather than silently applied or silently dropped."
//
// Scenario: an inspector views a PENDING roll, goes offline, and queues
// "PASS". Before they reconnect, a DIFFERENT inspector directly marks the
// same roll "REJECT" on the server. When the first device reconnects and
// replays its stale "PASS", the server must refuse to overwrite the REJECT
// (no silent clobber) and the client must flag the queued item for human
// review (no silent drop) instead of quietly retrying or discarding it.
import "fake-indexeddb/auto";
import {
  enqueueOfflineMutation,
  getAllQueuedItems,
  replayOfflineQueue,
  discardQueuedItem,
} from "../src/lib/offline-queue";
import { db } from "../src/lib/db";

type GlobalPatch = typeof globalThis & { __BASE_URL__?: string; __AUTH_COOKIE__?: string };
const patchedGlobal = globalThis as GlobalPatch;

if (typeof window === "undefined") {
  (patchedGlobal as unknown as { window: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  };
}
if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
} else {
  (patchedGlobal as unknown as { navigator: unknown }).navigator = { onLine: true };
}

const BASE = process.env.BASE ?? "http://localhost:3000";
patchedGlobal.__BASE_URL__ = BASE;

async function loginOwner(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "owner", password: "owner123" }),
  });
  if (!res.ok) throw new Error(`Owner login failed: HTTP ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No session cookie returned");
  return cookie;
}

async function main() {
  console.log("=== Offline conflict-on-sync test ===\n");

  const cookie = await loginOwner();
  patchedGlobal.__AUTH_COOKIE__ = cookie;

  const order = await db.order.findFirst({ where: { status: { in: ["CONFIRMED", "IN_PRODUCTION", "READY"] } } });
  const workOrder = await db.workOrder.findFirst();
  const machine = await db.machine.findFirst();
  const yarnLot = await db.yarnLot.findFirst();
  if (!order || !workOrder || !machine || !yarnLot) throw new Error("Missing fixture data in database");

  const ts = Date.now();
  const roll = await db.roll.create({
    data: {
      rollNo: `ROL-CONF-${ts}`,
      orderId: order.id,
      workOrderId: workOrder.id,
      machineId: machine.id,
      yarnLotId: yarnLot.id,
      shift: "Morning (Shift A)",
      lengthMetres: 100,
      weightKg: 20,
      qcStatus: "PENDING",
      qrToken: `QR-CONF-${ts}`,
    },
  });
  console.log(`1. Created test roll ${roll.rollNo} (qcStatus=PENDING)\n`);

  try {
    // 2. Device A views the roll while online (baseQcStatus=PENDING), then goes offline.
    console.log("2. Device A goes offline, queues PASS against baseQcStatus=PENDING...");
    (navigator as unknown as { onLine: boolean }).onLine = false;
    const queued = await enqueueOfflineMutation("qc_entry", `/api/rolls/${roll.id}/qc`, "POST", {
      result: "PASS",
      defects: [],
      baseQcStatus: "PENDING",
    });
    console.log(`   ✓ Queued mutation ${queued.id}\n`);

    // 3. A different inspector directly rejects the same roll on the server
    //    while device A is still offline.
    console.log("3. A different inspector directly marks the roll REJECT on the server...");
    const directRes = await fetch(`${BASE}/api/rolls/${roll.id}/qc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ result: "REJECT", defects: ["hole"] }),
    });
    if (!directRes.ok) throw new Error(`Direct REJECT failed: HTTP ${directRes.status}`);
    console.log("   ✓ Server-side roll is now REJECT\n");

    // 4. Device A reconnects and replays its stale queued PASS.
    console.log("4. Device A reconnects and replays its queue...");
    (navigator as unknown as { onLine: boolean }).onLine = true;
    const { successCount, failureCount } = await replayOfflineQueue();
    console.log(`   Replay result: ${successCount} succeeded, ${failureCount} failed\n`);
    if (successCount !== 0 || failureCount !== 1) {
      throw new Error(`Expected 0 successes / 1 failure, got ${successCount} successes / ${failureCount} failures`);
    }

    // 5. Assert: not silently applied — server roll is still REJECT, not PASS.
    const afterReplay = await db.roll.findUnique({ where: { id: roll.id }, include: { qcRecords: true } });
    if (afterReplay?.qcStatus !== "REJECT") {
      throw new Error(`FAIL: roll was silently overwritten — qcStatus is '${afterReplay?.qcStatus}', expected 'REJECT'`);
    }
    if (afterReplay.qcRecords.length !== 1) {
      throw new Error(`FAIL: expected exactly 1 QC record (the REJECT), found ${afterReplay.qcRecords.length}`);
    }
    console.log("5. PASS: not silently applied — server roll is still REJECT, exactly 1 QC record exists\n");

    // 6. Assert: not silently dropped — the item is still in the queue, flagged.
    const items = await getAllQueuedItems();
    const flagged = items.find((i) => i.id === queued.id);
    if (!flagged) throw new Error("FAIL: queued item vanished — it was silently dropped, not flagged");
    if (flagged.status !== "conflict") {
      throw new Error(`FAIL: expected status 'conflict', got '${flagged.status}'`);
    }
    if (!flagged.lastError || !flagged.lastError.includes("REJECT")) {
      throw new Error(`FAIL: expected lastError to mention the conflicting REJECT, got: ${flagged.lastError}`);
    }
    console.log(`6. PASS: not silently dropped — item flagged status='conflict', lastError="${flagged.lastError}"\n`);

    // 7. A human discards the flagged item (having re-done the inspection live).
    await discardQueuedItem(queued.id);
    const afterDiscard = await getAllQueuedItems();
    if (afterDiscard.some((i) => i.id === queued.id)) throw new Error("FAIL: discard did not remove the item");
    console.log("7. PASS: discard removes the flagged item once a human resolves it\n");

    console.log("=== PASS: conflict is flagged, never silently applied or dropped ===");
  } finally {
    await db.qCRecord.deleteMany({ where: { rollId: roll.id } }).catch(() => {});
    await db.roll.deleteMany({ where: { id: roll.id } }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
