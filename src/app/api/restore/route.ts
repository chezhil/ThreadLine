import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { withWriteLock } from "@/lib/concurrency";
import { qualityActor } from "@/lib/quality/auth";
import { sqliteFilePath } from "@/lib/quality/db-file";
import { snapshotTo, validateDatabaseFile } from "@/lib/quality/db-snapshot";

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(req: NextRequest) {
  // Replaces the whole database — owner only.
  const actor = await qualityActor("owner");
  if ("response" in actor) return actor.response;
  // File-swap restore only applies to the SQLite file layout; on Postgres
  // (Supabase) restore via `pg_restore` / the Supabase dashboard instead.
  if (!process.env.DATABASE_URL?.startsWith("file:")) {
    return NextResponse.json(
      { error: "This instance runs on Postgres — use your database provider's restore tooling (e.g. Supabase dashboard or pg_restore) instead." },
      { status: 501 },
    );
  }
  const dbPath = sqliteFilePath();
  const candidate = `${dbPath}.restore-${Date.now()}-${process.pid}.tmp`;
  try {
    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "The file is larger than 200 MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.subarray(0, 16).toString("utf-8").startsWith("SQLite format 3")) {
      return NextResponse.json(
        { error: "Invalid file format: uploaded file is not a valid SQLite database" },
        { status: 400 }
      );
    }

    // Validate a separate copy first; the live database is untouched unless
    // the upload is a complete, same-version ThreadLine database.
    fs.writeFileSync(candidate, buffer);
    const problem = await validateDatabaseFile(candidate);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }

    // Swap with no write in flight: keep a consistent copy of the current
    // data, close Prisma's handle, drop stale journal files that belong to
    // the old file, then atomically rename the validated copy into place.
    const savedAs = await withWriteLock(async () => {
      const safety = `${dbPath}.bak.${Date.now()}`;
      if (fs.existsSync(dbPath)) await snapshotTo(safety);
      await db.$disconnect();
      for (const suffix of ["-journal", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });
      fs.renameSync(candidate, dbPath);
      await db.$connect();
      // server.js keeps its own client for socket sign-in checks; drop its
      // handle on the replaced file too (it reconnects on the next query).
      const socketDb = (globalThis as { __threadlineSocketDb?: { $disconnect(): Promise<void> } }).__threadlineSocketDb;
      await socketDb?.$disconnect();
      return safety;
    });

    return NextResponse.json({
      success: true,
      message: "Database restored successfully. Sign in again if you are asked to.",
      previousCopy: savedAs.split(/[\\/]/).pop(),
    });
  } catch (err) {
    console.error("Database restore failed:", err);
    return NextResponse.json({ error: "Failed to restore database" }, { status: 500 });
  } finally {
    fs.rmSync(candidate, { force: true });
  }
}
