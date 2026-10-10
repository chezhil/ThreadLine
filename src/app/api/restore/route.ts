import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
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

    const dbPath = path.join(process.cwd(), "prisma", "dev.db");
    const backupExisting = path.join(process.cwd(), "prisma", `dev.db.bak.${Date.now()}`);

    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupExisting);
    }

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
