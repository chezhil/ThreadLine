import "fake-indexeddb/auto";
import {
  enqueueOfflineMutation,
  getAllQueuedItems,
  getPendingCount,
  replayOfflineQueue,
  subscribeToOfflineQueue,
} from "../src/lib/offline-queue";
import { db } from "../src/lib/db";

// Polyfill window & navigator for Node.js execution
type Listener = (event: { type: string }) => void;
const testGlobals = globalThis as unknown as Record<string, unknown>;
if (typeof window === "undefined") {
  const listeners: Record<string, Listener[]> = {};
  testGlobals.window = {
    addEventListener: (event: string, fn: Listener) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(fn);
    },
    removeEventListener: (event: string, fn: Listener) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((f) => f !== fn);
      }
    },
    dispatchEvent: (event: { type: string }) => {
      const handlers = listeners[event.type] || [];
      handlers.forEach((h) => h(event));
    },
  };
}

if (typeof navigator !== "undefined") {
  Object.defineProperty(navigator, "onLine", {
    value: true,
    writable: true,
    configurable: true,
  });
} else {
  testGlobals.navigator = {
    onLine: true,
  };
}

const BASE = process.env.BASE ?? "http://localhost:3000";
testGlobals.__BASE_URL__ = BASE;

function getHeaderBadgeText(online: boolean, pendingCount: number) {
  if (!online) {
    return `🔴 Offline (${pendingCount} pending sync)`;
  }
  if (pendingCount > 0) {
    return `Sync Pending (${pendingCount})`;
  }
  return `🟢 Online`;
}

async function loginOwner(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "owner", password: "owner123" }),
  });
  if (!res.ok) {
    throw new Error(`Owner login failed: HTTP ${res.status}`);
  }
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No session cookie returned");
  return cookie;
}

async function main() {
  console.log("=== Real-World Offline Sync Stress Test & Verification ===\n");

  // 1. Authenticate as Owner
  console.log("1. Authenticating as Owner...");
  const cookie = await loginOwner();
  testGlobals.__AUTH_COOKIE__ = cookie;
  console.log("   ✓ Authenticated successfully.\n");

  // 2. Setup baseline test rolls
  console.log("2. Preparing test rolls and orders...");
  const order = await db.order.findFirst({
    where: { status: { in: ["CONFIRMED", "IN_PRODUCTION", "READY"] } },
    include: { buyer: true },
  });
  if (!order) throw new Error("No eligible test order found in database");

  const workOrder = await db.workOrder.findFirst();
  const machine = await db.machine.findFirst();
  const yarnLot = await db.yarnLot.findFirst();

  if (!workOrder || !machine || !yarnLot) {
    throw new Error("Missing work order, machine, or yarn lot fixture in database");
  }

  const timestamp = Date.now();
  const roll1 = await db.roll.create({
    data: {
      rollNo: `ROL-OFF-PASS-${timestamp}`,
      orderId: order.id,
      workOrderId: workOrder.id,
      machineId: machine.id,
      yarnLotId: yarnLot.id,
      shift: "Morning (Shift A)",
      lengthMetres: 100,
      weightKg: 20,
      qcStatus: "PENDING",
      qrToken: `QR-OFF-1-${timestamp}`,
    },
  });

  const roll2 = await db.roll.create({
    data: {
      rollNo: `ROL-OFF-REW-${timestamp}`,
      orderId: order.id,
      workOrderId: workOrder.id,
      machineId: machine.id,
      yarnLotId: yarnLot.id,
      shift: "Morning (Shift A)",
      lengthMetres: 100,
      weightKg: 20,
      qcStatus: "PENDING",
      qrToken: `QR-OFF-2-${timestamp}`,
    },
  });

  const roll3 = await db.roll.create({
    data: {
      rollNo: `ROL-OFF-REJ-${timestamp}`,
      orderId: order.id,
      workOrderId: workOrder.id,
      machineId: machine.id,
      yarnLotId: yarnLot.id,
      shift: "Morning (Shift A)",
      lengthMetres: 100,
      weightKg: 20,
      qcStatus: "PENDING",
      qrToken: `QR-OFF-3-${timestamp}`,
    },
  });

  console.log(`   ✓ Created 3 test rolls:`);
  console.log(`     - Roll 1 (For PASS & Dispatch): ${roll1.rollNo} (${roll1.id})`);
  console.log(`     - Roll 2 (For REWORK): ${roll2.rollNo} (${roll2.id})`);
  console.log(`     - Roll 3 (For REJECT): ${roll3.rollNo} (${roll3.id})\n`);

  // Track Header Pill State
  let livePendingCount = 0;
  const unsubscribe = subscribeToOfflineQueue((count) => {
    livePendingCount = count;
  });

  let m4: Awaited<ReturnType<typeof enqueueOfflineMutation>> | null = null;

  try {
    // Initial State Check
    const initialBadge = getHeaderBadgeText(navigator.onLine, livePendingCount);
    console.log(`3. Initial State: ${initialBadge}`);
    if (initialBadge !== "🟢 Online") {
      throw new Error(`Expected initial badge to be '🟢 Online', got '${initialBadge}'`);
    }

    // 4. Simulate Network Drop: window.navigator.onLine = false
    console.log("\n4. Simulating Network Drop (navigator.onLine = false)...");
    (navigator as { onLine: boolean }).onLine = false;

    // Submit 3 Roll Inspections
    console.log("   -> Enqueuing QC Inspection: Roll 1 -> PASS");
    const m1 = await enqueueOfflineMutation(
      "qc_entry",
      `/api/rolls/${roll1.id}/qc`,
      "POST",
      { result: "PASS", defects: [] }
    );

    console.log("   -> Enqueuing QC Inspection: Roll 2 -> REWORK (uneven_weave)");
    await enqueueOfflineMutation(
      "qc_entry",
      `/api/rolls/${roll2.id}/qc`,
      "POST",
      { result: "REWORK", defects: ["uneven_weave"] }
    );

    console.log("   -> Enqueuing QC Inspection: Roll 3 -> REJECT (hole)");
    await enqueueOfflineMutation(
      "qc_entry",
      `/api/rolls/${roll3.id}/qc`,
      "POST",
      { result: "REJECT", defects: ["hole"] }
    );

    // Submit 1 Dispatch Batch
    console.log("   -> Enqueuing Dispatch Batch for Roll 1 (PASS)");
    m4 = await enqueueOfflineMutation(
      "dispatch",
      `/api/dispatches`,
      "POST",
      {
        buyerId: order.buyerId,
        truckNo: `TN 99 OFF ${Math.floor(Math.random() * 9000 + 1000)}`,
        rollIds: [roll1.id],
      }
    );

    // 5. Verify Persistence in IndexedDB
    console.log("\n5. Verifying IndexedDB Persistence & Client UUIDs...");
    const pendingCount = await getPendingCount();
    console.log(`   ✓ Pending count: ${pendingCount}`);
    if (pendingCount !== 4) {
      throw new Error(`Expected 4 pending items, got ${pendingCount}`);
    }

    const queuedItems = await getAllQueuedItems();
    if (queuedItems.length !== 4) {
      throw new Error(`Expected 4 items in IndexedDB, got ${queuedItems.length}`);
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of queuedItems) {
      if (!uuidRegex.test(item.id)) {
        throw new Error(`Item ${item.id} does not have a valid client UUID`);
      }
      if (item.status !== "pending") {
        throw new Error(`Item ${item.id} status is '${item.status}', expected 'pending'`);
      }
      if (item.payload.clientMutationId !== item.id) {
        throw new Error(`Item ${item.id} payload does not contain clientMutationId`);
      }
      console.log(`   ✓ Verified mutation [${item.type}] with UUID: ${item.id}`);
    }

    // Verify UI Header Pill Transition
    const offlineBadge = getHeaderBadgeText(navigator.onLine, pendingCount);
    console.log(`\n6. Verifying UI Header Badge: "${offlineBadge}"`);
    if (offlineBadge !== "🔴 Offline (4 pending sync)") {
      throw new Error(`Expected '🔴 Offline (4 pending sync)', got '${offlineBadge}'`);
    }

    // 7. Simulate Network Reconnect
    console.log("\n7. Simulating Network Reconnect (navigator.onLine = true)...");
    (navigator as { onLine: boolean }).onLine = true;

    // Trigger FIFO queue drain
    console.log("8. Triggering FIFO queue drain & replay...");
    const { successCount, failureCount } = await replayOfflineQueue();
    console.log(`   ✓ Replay finished: ${successCount} succeeded, ${failureCount} failed`);

    if (failureCount > 0 || successCount !== 4) {
      throw new Error(`Replay failed: expected 4 successes, got ${successCount} successes and ${failureCount} failures`);
    }

    const remainingCount = await getPendingCount();
    console.log(`   ✓ Remaining pending items in queue: ${remainingCount}`);
    if (remainingCount !== 0) {
      throw new Error(`Queue was not fully drained. Remaining: ${remainingCount}`);
    }

    // Verify UI Header Badge returns to Online
    const onlineBadge = getHeaderBadgeText(navigator.onLine, remainingCount);
    console.log(`   ✓ Header badge returned to: "${onlineBadge}"`);
    if (onlineBadge !== "🟢 Online") {
      throw new Error(`Expected '🟢 Online', got '${onlineBadge}'`);
    }

    // 9. Verify Server-side Database State
    console.log("\n9. Verifying Database State post-replay...");
    const [dbRoll1, dbRoll2, dbRoll3] = await Promise.all([
      db.roll.findUnique({ where: { id: roll1.id }, include: { qcRecords: true, dispatch: true } }),
      db.roll.findUnique({ where: { id: roll2.id }, include: { qcRecords: true } }),
      db.roll.findUnique({ where: { id: roll3.id }, include: { qcRecords: true } }),
    ]);

    if (dbRoll1?.qcStatus !== "PASS" || !dbRoll1.dispatchId) {
      throw new Error(`Roll 1 state invalid: qcStatus=${dbRoll1?.qcStatus}, dispatchId=${dbRoll1?.dispatchId}`);
    }
    console.log(`   ✓ Roll 1: qcStatus='PASS', dispatched via Dispatch ${dbRoll1.dispatchId}`);

    if (dbRoll2?.qcStatus !== "REWORK") {
      throw new Error(`Roll 2 state invalid: qcStatus=${dbRoll2?.qcStatus}`);
    }
    console.log(`   ✓ Roll 2: qcStatus='REWORK'`);

    if (dbRoll3?.qcStatus !== "REJECT") {
      throw new Error(`Roll 3 state invalid: qcStatus=${dbRoll3?.qcStatus}`);
    }
    console.log(`   ✓ Roll 3: qcStatus='REJECT'`);

    if (dbRoll1.qcRecords.length !== 1 || dbRoll2?.qcRecords.length !== 1 || dbRoll3?.qcRecords.length !== 1) {
      throw new Error("Unexpected number of QC records created during drain");
    }
    console.log(`   ✓ Exactly 1 QC record per roll created.`);

    // 10. Verify Client-UUID Idempotency
    console.log("\n10. Verifying Server-side Client-UUID Idempotency (replay attack test)...");
    const replayedQc1 = await fetch(`${BASE}/api/rolls/${roll1.id}/qc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(m1.payload),
    });
    if (!replayedQc1.ok) {
      throw new Error(`QC 1 re-submission failed with HTTP ${replayedQc1.status}`);
    }
    await replayedQc1.json();
    console.log(`   ✓ QC 1 idempotent response accepted (HTTP 200).`);

    const replayedDispatch = await fetch(`${BASE}/api/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify(m4.payload),
    });
    if (!replayedDispatch.ok) {
      throw new Error(`Dispatch re-submission failed with HTTP ${replayedDispatch.status}`);
    }
    await replayedDispatch.json();
    console.log(`   ✓ Dispatch idempotent response accepted (HTTP 200).`);

    // Verify DB count still 1
    const checkRoll1 = await db.roll.findUnique({
      where: { id: roll1.id },
      include: { qcRecords: true },
    });
    if (checkRoll1?.qcRecords.length !== 1) {
      throw new Error(`Duplicate QC record created! Count: ${checkRoll1?.qcRecords.length}`);
    }
    console.log(`   ✓ Zero duplicate QC records created.`);

    const dispatchCount = await db.dispatch.count({
      where: { id: m4.id },
    });
    if (dispatchCount !== 1) {
      throw new Error(`Duplicate Dispatch created! Count: ${dispatchCount}`);
    }
    console.log(`   ✓ Zero duplicate dispatches created.`);

    console.log("\n=======================================================");
    console.log("PASS: Real-World Offline Sync Stress Test Successful!");
    console.log("=======================================================\n");
  } finally {
    unsubscribe();
    // Clean up test fixtures safely in reverse dependency order
    try {
      await db.roll.updateMany({
        where: { id: roll1.id },
        data: { dispatchId: null },
      });
      if (m4?.id) {
        await db.dispatch.deleteMany({
          where: { id: m4.id },
        }).catch(() => {});
      }
      await db.qCRecord.deleteMany({
        where: { rollId: { in: [roll1.id, roll2.id, roll3.id] } },
      }).catch(() => {});
      await db.roll.deleteMany({
        where: { id: { in: [roll1.id, roll2.id, roll3.id] } },
      }).catch(() => {});
    } catch {
      // ignore cleanup errors
    }
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
