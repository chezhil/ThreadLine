import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { qualityActor } from "@/lib/quality/auth";
import { sqliteFilePath } from "@/lib/quality/db-file";


export async function GET(_req: NextRequest) {
  // A full copy of the database (incl. password hashes) — owner only.
  const actor = await qualityActor("owner");
  if ("response" in actor) return actor.response;
  try {
    const dbPath = sqliteFilePath();

    if (!fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Database file not found" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(dbPath);
    const dateStr = new Date().toISOString().slice(0, 10);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/x-sqlite3",
        "Content-Disposition": `attachment; filename="threadline-backup-${dateStr}.db"`,
      },
    });
  } catch (err: any) {
    console.error("Backup failed:", err);
    return NextResponse.json({ error: "Failed to generate backup" }, { status: 500 });
  }
}
