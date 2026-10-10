import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { db } from "@/lib/db";
import { qualityActor } from "@/lib/quality/auth";
import { sqliteFilePath } from "@/lib/quality/db-file";

export async function POST(req: NextRequest) {
  // Replaces the whole database — owner only.
  const actor = await qualityActor("owner");
  if ("response" in actor) return actor.response;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Verify it looks like SQLite header
    const header = buffer.subarray(0, 16).toString("utf-8");
    if (!header.startsWith("SQLite format 3")) {
      return NextResponse.json(
        { error: "Invalid file format: uploaded file is not a valid SQLite database" },
        { status: 400 }
      );
    }

    const dbPath = sqliteFilePath();
    const backupExisting = `${dbPath}.bak.${Date.now()}`;

    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupExisting);
    }

    // Close Prisma's handle on the old file before swapping it; the next query reconnects.
    await db.$disconnect();
    fs.writeFileSync(dbPath, buffer);

    return NextResponse.json({
      success: true,
      message: "Database restored successfully",
    });
  } catch (err: any) {
    console.error("Database restore failed:", err);
    return NextResponse.json({ error: "Failed to restore database" }, { status: 500 });
  }
}
