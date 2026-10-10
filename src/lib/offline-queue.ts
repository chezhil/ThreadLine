import { openDB, DBSchema, IDBPDatabase } from "idb";

export interface QueuedMutation {
  id: string; // client-generated UUID, sent as clientMutationId
  type: "qc_entry" | "production_log" | "roll_scan" | "dispatch" | string;
  url: string;
  method: "POST" | "PUT" | "PATCH";
  payload: Record<string, unknown>;
  createdAt: string;
  // "conflict": the server rejected this with 409 — someone else changed the
  // same record differently while this client was offline. Distinct from
  // "failed" (a validation/permission rejection) so the UI can tell "this
  // needs a human to look at and resubmit" apart from "this was just wrong."
  status: "pending" | "syncing" | "failed" | "conflict";
  attempts: number;
  // The signed-in user who queued it. Only that user's session replays it,
  // so a shared tablet never posts one person's inspections under another's
  // login.
  userId?: string;
  lastError?: string;
  nextRetryAt?: string;
  // Set when the server answered 401/403: the item is kept (not failed) and
  // waits until its user signs in again.
  needsSignIn?: boolean;
}

interface ThreadLineDB extends DBSchema {
  offlineQueue: {
    key: string;
    value: QueuedMutation;
    indexes: { "by-status": string };
  };
}

const DB_NAME = "threadline_offline_v1";
const STORE_NAME = "offlineQueue";

let dbPromise: Promise<IDBPDatabase<ThreadLineDB>> | null = null;

// In-memory fallback store for Node.js test environments or when IndexedDB is unavailable
const memoryStore: Map<string, QueuedMutation> = new Map();

// Test hooks: the Node test script has no window/same-origin cookie, so it
// sets these on globalThis. A browser never reads them.
const testGlobals = globalThis as unknown as { __BASE_URL__?: string; __AUTH_COOKIE__?: string };

function isIndexedDBAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

async function getDB() {
  if (!isIndexedDBAvailable()) return null;
  if (!dbPromise) {
    dbPromise = openDB<ThreadLineDB>(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("by-status", "status");
        }
      },
    });
  }
  return dbPromise;
}

async function putItem(item: QueuedMutation) {
  const db = await getDB();
  if (db) await db.put(STORE_NAME, item);
  else memoryStore.set(item.id, item);
}

async function deleteItem(id: string) {
  const db = await getDB();
  if (db) await db.delete(STORE_NAME, id);
  else memoryStore.delete(id);
}

export type QueueSubscriber = (count: number, isSyncing: boolean, failedCount: number) => void;
const subscribers: Set<QueueSubscriber> = new Set();
let isCurrentlySyncing = false;
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentUserId: string | null = null;

async function notifySubscribers() {
  const [count, failed] = await Promise.all([getPendingCount(), getFailedCount()]);
  subscribers.forEach((fn) => fn(count, isCurrentlySyncing, failed));
}

export function subscribeToOfflineQueue(callback: QueueSubscriber) {
  subscribers.add(callback);
  Promise.all([getPendingCount(), getFailedCount()]).then(([count, failed]) =>
    callback(count, isCurrentlySyncing, failed),
  );
  return () => {
    subscribers.delete(callback);
  };
}

/** Scope the queue to the signed-in user (called by the app shell). */
export function setOfflineQueueUser(userId: string | null) {
  currentUserId = userId;
  void notifySubscribers();
}

/** A client mutation id. crypto.randomUUID only exists in secure contexts,
 * and the mill tablets may reach the app over plain http on the LAN. */
export function newMutationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `offline-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Enqueue a mutation for offline replay. Pass `id` to reuse the
 * clientMutationId of an online attempt that may already have reached the
 * server, so the replay is recognised as the same write.
 */
export async function enqueueOfflineMutation(
  type: string,
  url: string,
  method: "POST" | "PUT" | "PATCH",
  payload: Record<string, unknown>,
  opts: { id?: string } = {},
): Promise<QueuedMutation> {
  const id = opts.id ?? newMutationId();
  const createdAt = new Date().toISOString();

  const mutation: QueuedMutation = {
    id,
    type,
    url,
    method,
    payload: {
      ...payload,
      clientMutationId: id,
      clientRecordedAt: createdAt,
    },
    createdAt,
    status: "pending",
    attempts: 0,
    userId: currentUserId ?? undefined,
  };

  await putItem(mutation);
  await notifySubscribers();
  return mutation;
}

/** Items the current user may replay (legacy items without a user count as theirs). */
function mine(item: QueuedMutation) {
  return !item.userId || !currentUserId || item.userId === currentUserId;
}

async function readAll(): Promise<QueuedMutation[]> {
  const db = await getDB();
  if (db) {
    try {
      return await db.getAll(STORE_NAME);
    } catch {
      return [];
    }
  }
  return Array.from(memoryStore.values());
}

/** Count of the current user's items still waiting to sync. */
export async function getPendingCount(): Promise<number> {
  return (await readAll()).filter((i) => mine(i) && (i.status === "pending" || i.status === "syncing")).length;
}

/** Count of the current user's items the server rejected or flagged as a
 * conflict — both need a person to look at them. */
export async function getFailedCount(): Promise<number> {
  return (await readAll()).filter((i) => mine(i) && (i.status === "failed" || i.status === "conflict")).length;
}

/** The current user's queued items, oldest first. */
export async function getAllQueuedItems(): Promise<QueuedMutation[]> {
  return (await readAll()).filter(mine).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Put a failed item back in line. A "conflict" item is never retried: the
 * newer inspection on the server wins, and the person re-inspects live. */
export async function retryQueuedItem(id: string) {
  const item = (await readAll()).find((i) => i.id === id);
  if (!item || item.status === "conflict") return;
  await putItem({ ...item, status: "pending", nextRetryAt: undefined, lastError: undefined });
  await notifySubscribers();
}

/** Drop an item without replaying it — a "failed" or "conflict" item a
 * person reviewed and resolved some other way (e.g. re-did the inspection
 * live). Never called by replay itself; always an explicit user action. */
export async function discardQueuedItem(id: string) {
  await deleteItem(id);
  await notifySubscribers();
}

/**
 * Compute exponential backoff with random jitter for transient server errors (500/503)
 */
function calculateBackoffWithJitter(attempts: number): number {
  // Base 1000ms, max 30000ms, plus 0-500ms random jitter
  const exponential = Math.min(30000, Math.pow(2, attempts) * 1000);
  const jitter = Math.floor(Math.random() * 500);
  return exponential + jitter;
}

const TRANSIENT = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Replay the offline queue, oldest first, with backoff and idempotency handling
 */
export async function replayOfflineQueue(): Promise<{
  successCount: number;
  failureCount: number;
}> {
  if (isCurrentlySyncing) return { successCount: 0, failureCount: 0 };

  isCurrentlySyncing = true;
  await notifySubscribers();

  let successCount = 0;
  let failureCount = 0;
  const inBrowser = typeof window !== "undefined" && typeof document !== "undefined";

  try {
    const now = Date.now();
    const pendingItems = (await getAllQueuedItems()).filter((i) => {
      if (i.status !== "pending" && i.status !== "syncing") return false;
      if (i.nextRetryAt && new Date(i.nextRetryAt).getTime() > now) return false;
      return true;
    });

    for (const item of pendingItems) {
      try {
        await putItem({ ...item, status: "syncing" });

        // In the browser the queued relative URL goes to the app's own origin
        // with the session cookie. Only the Node test harness needs a base URL
        // and an explicit cookie.
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        let fullUrl = item.url;
        if (!inBrowser) {
          if (!item.url.startsWith("http")) fullUrl = `${testGlobals.__BASE_URL__ ?? "http://localhost:3000"}${item.url}`;
          if (testGlobals.__AUTH_COOKIE__) headers["cookie"] = testGlobals.__AUTH_COOKIE__;
        }

        const res = await fetch(fullUrl, {
          method: item.method,
          headers,
          credentials: "same-origin",
          body: JSON.stringify(item.payload),
        });

        if (res.ok) {
          await deleteItem(item.id);
          successCount++;
        } else if (res.status === 401 || res.status === 403) {
          // Signed out or session expired: keep the item for when its user
          // signs in again, and stop — every later item would get the same.
          await putItem({
            ...item,
            status: "pending",
            needsSignIn: true,
            lastError: "Sign in again to send this",
          });
          failureCount++;
          break;
        } else if (res.status === 409) {
          // Genuine conflict (not transient, not just wrong input): someone
          // changed the same record differently while this client was
          // offline. Never retried automatically and never dropped silently —
          // the item waits in the queue drawer until a person discards it
          // (or re-does the work live). Later items are independent, so the
          // replay carries on.
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          await putItem({
            ...item,
            status: "conflict",
            attempts: item.attempts + 1,
            needsSignIn: false,
            lastError: errData.error || "This record changed on the server since you went offline.",
          });
          failureCount++;
        } else if (TRANSIENT.has(res.status)) {
          const attempts = item.attempts + 1;
          const delayMs = calculateBackoffWithJitter(attempts);
          await putItem({
            ...item,
            status: "pending",
            attempts,
            needsSignIn: false,
            nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
            lastError: `HTTP ${res.status}: Temporary server error. Retrying in ${Math.round(delayMs / 1000)}s`,
          });
          failureCount++;
        } else {
          // The server rejected it (400, 404, 409...): keep it visible so the
          // user can read why and retry or discard it.
          const errData = (await res.json().catch(() => ({}))) as {
            error?: string;
            fieldErrors?: Record<string, unknown>;
          };
          const fieldMsg = errData.fieldErrors
            ? Object.values(errData.fieldErrors).flat().filter(Boolean).join("; ")
            : "";
          await putItem({
            ...item,
            status: "failed",
            attempts: item.attempts + 1,
            needsSignIn: false,
            lastError: errData.error || fieldMsg || `HTTP ${res.status}`,
          });
          failureCount++;
        }
      } catch (networkErr) {
        // Network drop during sync -> revert to pending and stop loop
        await putItem({
          ...item,
          status: "pending",
          attempts: item.attempts + 1,
          lastError: networkErr instanceof Error && networkErr.message ? networkErr.message : "Network unreachable",
        });
        failureCount++;
        break;
      }
    }
  } finally {
    isCurrentlySyncing = false;
    await notifySubscribers();
  }

  return { successCount, failureCount };
}

/**
 * Debounced replay to prevent sync storms when connection rapidly flutters
 */
export function debouncedReplayOfflineQueue(delayMs = 400) {
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }
  syncDebounceTimer = setTimeout(() => {
    replayOfflineQueue();
  }, delayMs);
}

// Auto-trigger debounced replay when returning online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    debouncedReplayOfflineQueue(400);
  });
}
