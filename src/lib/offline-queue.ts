import { openDB, DBSchema, IDBPDatabase } from "idb";

export interface QueuedMutation {
  id: string; // client-generated UUID
  type: "qc_entry" | "production_log" | "roll_scan" | "dispatch" | string;
  url: string;
  method: "POST" | "PUT" | "PATCH";
  payload: any;
  createdAt: string;
  status: "pending" | "syncing" | "failed";
  attempts: number;
  lastError?: string;
  nextRetryAt?: string;
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

export type QueueSubscriber = (count: number, isSyncing: boolean) => void;
const subscribers: Set<QueueSubscriber> = new Set();
let isCurrentlySyncing = false;
let syncDebounceTimer: any = null;

function notifySubscribers(count: number) {
  subscribers.forEach((fn) => fn(count, isCurrentlySyncing));
}

export function subscribeToOfflineQueue(callback: QueueSubscriber) {
  subscribers.add(callback);
  getPendingCount().then((count) => callback(count, isCurrentlySyncing));
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Enqueue a mutation for offline replay
 */
export async function enqueueOfflineMutation(
  type: string,
  url: string,
  method: "POST" | "PUT" | "PATCH",
  payload: any
): Promise<QueuedMutation> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `offline-${Date.now()}-${Math.random()}`;

  const mutation: QueuedMutation = {
    id,
    type,
    url,
    method,
    payload: {
      ...payload,
      clientMutationId: id,
    },
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
  };

  const db = await getDB();
  if (db) {
    await db.put(STORE_NAME, mutation);
  } else {
    memoryStore.set(id, mutation);
  }

  const count = await getPendingCount();
  notifySubscribers(count);

  return mutation;
}

/**
 * Get count of pending items
 */
export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  if (db) {
    try {
      const all = await db.getAll(STORE_NAME);
      return all.filter((item) => item.status === "pending" || item.status === "syncing").length;
    } catch {
      return 0;
    }
  } else {
    return Array.from(memoryStore.values()).filter(
      (item) => item.status === "pending" || item.status === "syncing"
    ).length;
  }
}

/**
 * Get all queued items
 */
export async function getAllQueuedItems(): Promise<QueuedMutation[]> {
  const db = await getDB();
  if (db) {
    return db.getAll(STORE_NAME);
  }
  return Array.from(memoryStore.values());
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

/**
 * Replay the offline queue with backoff and idempotency handling
 */
export async function replayOfflineQueue(): Promise<{
  successCount: number;
  failureCount: number;
}> {
  if (isCurrentlySyncing) return { successCount: 0, failureCount: 0 };

  isCurrentlySyncing = true;
  let count = await getPendingCount();
  notifySubscribers(count);

  let successCount = 0;
  let failureCount = 0;
  const db = await getDB();

  try {
    const all = db ? await db.getAll(STORE_NAME) : Array.from(memoryStore.values());
    const now = Date.now();
    const pendingItems = all.filter((i) => {
      if (i.status !== "pending" && i.status !== "syncing") return false;
      if (i.nextRetryAt && new Date(i.nextRetryAt).getTime() > now) return false;
      return true;
    });

    for (const item of pendingItems) {
      try {
        // Mark as syncing
        const updatedItem = { ...item, status: "syncing" as const };
        if (db) await db.put(STORE_NAME, updatedItem);
        else memoryStore.set(item.id, updatedItem);

        const fullUrl = item.url.startsWith("http")
          ? item.url
          : `${(globalThis as any).__BASE_URL__ || "http://localhost:3000"}${item.url}`;

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const authCookie = (globalThis as any).__AUTH_COOKIE__ || item.payload?.cookie;
        if (authCookie) {
          headers["cookie"] = authCookie;
        }

        const res = await fetch(fullUrl, {
          method: item.method,
          headers,
          body: JSON.stringify(item.payload),
        });

        if (res.ok) {
          // Successfully synced -> delete from queue
          if (db) await db.delete(STORE_NAME, item.id);
          else memoryStore.delete(item.id);
          successCount++;
        } else if (res.status === 500 || res.status === 503) {
          // Transient server error -> apply exponential backoff with jitter
          const attempts = item.attempts + 1;
          const delayMs = calculateBackoffWithJitter(attempts);
          const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

          const retryingItem: QueuedMutation = {
            ...item,
            status: "pending",
            attempts,
            nextRetryAt,
            lastError: `HTTP ${res.status}: Temporary server error. Retrying in ${Math.round(delayMs / 1000)}s`,
          };

          if (db) await db.put(STORE_NAME, retryingItem);
          else memoryStore.set(item.id, retryingItem);
          failureCount++;
        } else {
          // Client rejection (400, 403, 404, etc.)
          const errData = await res.json().catch(() => ({}));
          const failedItem: QueuedMutation = {
            ...item,
            status: "failed",
            attempts: item.attempts + 1,
            lastError: errData.error || `HTTP ${res.status}`,
          };

          if (db) await db.put(STORE_NAME, failedItem);
          else memoryStore.set(item.id, failedItem);
          failureCount++;
        }
      } catch (networkErr: any) {
        // Network drop during sync -> revert to pending and stop loop
        const pendingItem: QueuedMutation = {
          ...item,
          status: "pending",
          attempts: item.attempts + 1,
          lastError: networkErr.message || "Network unreachable",
        };

        if (db) await db.put(STORE_NAME, pendingItem);
        else memoryStore.set(item.id, pendingItem);

        failureCount++;
        break; // Stop replaying if network dropped
      }
    }
  } finally {
    isCurrentlySyncing = false;
    count = await getPendingCount();
    notifySubscribers(count);
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
