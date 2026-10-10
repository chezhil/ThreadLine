import { Prisma, type PrismaClient } from "@prisma/client";
import { db } from "./db";

const UNIQUE_CONSTRAINT = "P2002";
const WRITE_CONFLICT = "P2034";
const TRANSACTION_API = "P2028"; // e.g. couldn't get a connection/start in time

/**
 * Retries `fn` when it collides with another concurrent request: a unique
 * constraint race (two requests computed the same generated number) or a
 * SQLite write-lock conflict. `fn` must be idempotent-safe to re-run from
 * scratch each attempt — e.g. re-reading a count inside a fresh transaction,
 * never reusing a value computed before the first attempt.
 *
 * This is deliberately separate from wrapping the work in
 * `db.$transaction(async (tx) => ...)`, which `fn` should still do itself —
 * the transaction makes a single attempt atomic, this makes a colliding
 * attempt retry instead of surfacing a 500 to the user.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const retryable =
        (e instanceof Prisma.PrismaClientKnownRequestError &&
          (e.code === UNIQUE_CONSTRAINT || e.code === WRITE_CONFLICT || e.code === TRANSACTION_API)) ||
        (e instanceof Error && /database is locked|SQLITE_BUSY/i.test(e.message));
      if (!retryable) throw e;
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40));
    }
  }
  throw lastErr;
}

// One write transaction at a time in this server process (see below).
const globalForLock = globalThis as unknown as { threadlineWriteQueue?: Promise<unknown> };

/**
 * An interactive transaction for read-then-write work, run one at a time.
 *
 * Prisma opens SQLite transactions as DEFERRED: a transaction holds a shared
 * lock from its first statement and asks for the write lock later. Two such
 * transactions running at once each wait for the other to let go, until
 * Prisma's 5s timeout kills them. With 5 concurrent yarn reservations, every
 * request took ~5s and 2 to 4 of them failed with HTTP 500.
 *
 * SQLite only ever has one writer anyway, so queueing write transactions in
 * the (single) server process costs nothing and removes the deadlock. The
 * first statement takes the write lock, so plain single-statement writes from
 * elsewhere wait their turn instead of deadlocking with it.
 */
export function writeTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
export function writeTransaction<T>(client: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
export function writeTransaction<T>(
  a: PrismaClient | ((tx: Prisma.TransactionClient) => Promise<T>),
  b?: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const client = typeof a === "function" ? db : a;
  const fn = typeof a === "function" ? a : b!;
  const run = () =>
    client.$transaction(async (tx) => {
      // A write that touches no rows still takes the write lock.
      await tx.$executeRawUnsafe('UPDATE "User" SET "id" = "id" WHERE 0');
      return fn(tx);
    });
  const prev = globalForLock.threadlineWriteQueue ?? Promise.resolve();
  const next = prev.then(run, run);
  // The queue must keep going whether this transaction succeeds or fails.
  globalForLock.threadlineWriteQueue = next.catch(() => undefined);
  return next;
}
