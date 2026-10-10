import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

// Consistent copies of the live SQLite file. A plain file copy of a database
// that is being written can be torn (half of one transaction); VACUUM INTO
// writes a complete, compacted copy as of one moment.

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

export async function snapshotTo(target: string) {
  if (fs.existsSync(target)) fs.unlinkSync(target);
  await db.$executeRawUnsafe(`VACUUM INTO ${sqlString(target)}`);
}

export function migrationNames(): string[] {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

/** Checks a candidate database file before it may replace the live one:
 * SQLite integrity, the same schema version (applied migrations) as this
 * build, and at least one owner who can sign in afterwards. Returns a
 * user-facing reason when it is not acceptable. */
export async function validateDatabaseFile(file: string): Promise<string | null> {
  const client = new PrismaClient({ datasources: { db: { url: `file:${file}` } } });
  try {
    const integrity = await client.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
    if (integrity[0]?.integrity_check !== "ok") return "The file is damaged (SQLite integrity check failed)";
    const tables = await client.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'",
    );
    if (!tables.length) return "The file is not a ThreadLine backup (no migration history)";
    const applied = await client.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
    const have = new Set(applied.map((m) => m.migration_name));
    const expected = migrationNames();
    const missing = expected.filter((m) => !have.has(m));
    const unknown = [...have].filter((m) => !expected.includes(m));
    if (missing.length || unknown.length) {
      return `The backup is from a different version of ThreadLine (${missing.length} migration(s) missing, ${unknown.length} unknown). Restore it with a matching version, or migrate it first.`;
    }
    const owners = await client.user.count({ where: { role: "owner" } });
    if (owners === 0) return "The backup has no owner account, so nobody could sign in after restoring it";
    return null;
  } catch (err) {
    return `The file could not be read as a ThreadLine database (${err instanceof Error ? err.message.split("\n")[0] : "unknown error"})`;
  } finally {
    await client.$disconnect();
  }
}
