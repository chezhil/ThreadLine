import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { qualityActor } from "@/lib/quality/auth";
import { sqliteFilePath } from "@/lib/quality/db-file";
import { snapshotTo } from "@/lib/quality/db-snapshot";

export async function GET(_req: NextRequest) {
  // File-level backup only applies to the SQLite file layout; on Postgres
  // (Supabase) use `pg_dump` / Supabase's own backup tooling instead.
  if (!process.env.DATABASE_URL?.startsWith("file:")) {
    return NextResponse.json(
      { error: "This instance runs on Postgres — use your database provider's backup tooling (e.g. Supabase dashboard or pg_dump) instead." },
      { status: 501 },
    );
  }
  // A full copy of the database (incl. password hashes) — owner only.
  const actor = await qualityActor("owner");
  if ("response" in actor) return actor.response;
  const tmp = `${sqliteFilePath()}.backup-${Date.now()}-${process.pid}.tmp`;
  try {
    // A consistent snapshot, not a byte copy of a file that may be mid-write.
    await snapshotTo(tmp);
    const fileBuffer = fs.readFileSync(tmp);
    const dateStr = new Date().toISOString().slice(0, 10);

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="threadline-backup-${dateStr}.db"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Backup failed:", err);
    return NextResponse.json({ error: "Failed to generate backup" }, { status: 500 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
