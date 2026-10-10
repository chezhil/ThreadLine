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

function getDB() {
  if (typeof window === "undefined") return null;
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
  const db = await getDB();
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

  if (db) {
    await db.put(STORE_NAME, mutation);
    const count = await getPendingCount();
    notifySubscribers(count);
  }

  return mutation;
}

/**
 * Get count of pending items
 */
export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  if (!db) return 0;
  try {
    const all = await db.getAll(STORE_NAME);
    return all.filter((item) => item.status === "pending" || item.status === "syncing").length;
  } catch {
    return 0;
  }
}

/**
 * Get all queued items
 */
export async function getAllQueuedItems(): Promise<QueuedMutation[]> {
  const db = await getDB();
  if (!db) return [];
  return db.getAll(STORE_NAME);
}

/**
 * Replay the offline queue
 */
export async function replayOfflineQueue(): Promise<{
  successCount: number;
  failureCount: number;
}> {
  if (isCurrentlySyncing) return { successCount: 0, failureCount: 0 };
  const db = await getDB();
  if (!db) return { successCount: 0, failureCount: 0 };

  isCurrentlySyncing = true;
  let count = await getPendingCount();
  notifySubscribers(count);

  let successCount = 0;
  let failureCount = 0;

  try {
    const all = await db.getAll(STORE_NAME);
    const pendingItems = all.filter((i) => i.status === "pending" || i.status === "syncing");

    for (const item of pendingItems) {
      try {
        // Mark as syncing
        await db.put(STORE_NAME, { ...item, status: "syncing" });

        const res = await fetch(item.url, {
          method: item.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(item.payload),
        });

        if (res.ok) {
          // Successfully synced -> delete from queue
          await db.delete(STORE_NAME, item.id);
          successCount++;
        } else {
          // If server responded with 400, record error
          const errData = await res.json().catch(() => ({}));
          await db.put(STORE_NAME, {
            ...item,
            status: "failed",
            attempts: item.attempts + 1,
            lastError: errData.error || `HTTP ${res.status}`,
          });
          failureCount++;
        }
      } catch (networkErr: any) {
        // Still offline or connection dropped -> revert status to pending and stop loop
        await db.put(STORE_NAME, {
          ...item,
          status: "pending",
          attempts: item.attempts + 1,
          lastError: networkErr.message || "Network unreachable",
        });
        failureCount++;
        break; // Stop replaying if still offline
      }
    }
  } finally {
    isCurrentlySyncing = false;
    count = await getPendingCount();
    notifySubscribers(count);
  }

  return { successCount, failureCount };
}

// Auto-trigger replay when returning online
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    replayOfflineQueue();
  });
}
