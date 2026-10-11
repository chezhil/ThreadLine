import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Prisma over node-postgres. Through Supabase's transaction pooler (port
 * 6543) the built-in query engine needs `pgbouncer=true`, which costs ~5
 * round trips per query (~550 ms from India to Tokyo); node-postgres sends
 * each query in one (~120 ms) and is safe on that pooler. The Prisma-only
 * URL parameters are stripped here; `connection_limit` becomes the pool size. */
export function createPrismaClient(url = process.env.DATABASE_URL): PrismaClient {
  if (!url?.startsWith("postgres")) return new PrismaClient();
  const parsed = new URL(url);
  const max = Number(parsed.searchParams.get("connection_limit")) || 5;
  for (const key of ["pgbouncer", "connection_limit", "pool_timeout", "statement_cache_size", "schema"]) {
    parsed.searchParams.delete(key);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  // Encrypted like the built-in engine's default (sslmode=prefer): Supabase
  // signs with its own CA, so the chain isn't verified against system roots.
  const ssl = local || parsed.searchParams.get("sslmode") === "disable" ? false : { rejectUnauthorized: false };
  parsed.searchParams.delete("sslmode");
  const pool = new Pool({ connectionString: parsed.toString(), max, ssl });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
