import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const dbPath = path.join(process.cwd(), "prisma", "dev.db");

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
