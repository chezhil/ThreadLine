import { Prisma } from "@prisma/client";

const UNIQUE_CONSTRAINT = "P2002";
const WRITE_CONFLICT = "P2034";

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
          (e.code === UNIQUE_CONSTRAINT || e.code === WRITE_CONFLICT)) ||
        (e instanceof Error && /database is locked|SQLITE_BUSY/i.test(e.message));
      if (!retryable) throw e;
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40));
    }
  }
  throw lastErr;
}
