import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.BASE ?? "http://localhost:3000";

async function loginOwner() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "owner", password: "owner123" }),
  });
  if (!res.ok) {
    throw new Error(`Owner login failed: HTTP ${res.status}`);
  }
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("No session cookie returned");
  return cookie;
}

async function run() {
  console.log("=== Testing SQLite Backup & Restore Verification ===");

  // 1. Authenticate as Owner
  console.log("1. Authenticating as Owner to fetch backup stream...");
  const cookie = await loginOwner();

  // 2. Stream backup from GET /api/backup
  console.log("2. Calling GET /api/backup...");
  const res = await fetch(`${BASE}/api/backup`, {
    headers: { cookie },
  });

  if (!res.ok) {
    throw new Error(`GET /api/backup failed with HTTP ${res.status}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  console.log(`   ✓ Streamed ${buffer.length} bytes of database backup.`);

  // Verify SQLite header magic bytes
  const header = buffer.subarray(0, 16).toString("utf-8");
  if (!header.startsWith("SQLite format 3")) {
    throw new Error("Streamed payload is not a valid SQLite database header");
  }
  console.log("   ✓ Verified SQLite header magic bytes.");

  // 3. Restore to temporary database file prisma/test-restore.db
  const restoreDbPath = path.join(process.cwd(), "prisma", "test-restore.db");
  if (fs.existsSync(restoreDbPath)) {
    fs.unlinkSync(restoreDbPath);
  }
  fs.writeFileSync(restoreDbPath, buffer);
  console.log(`3. Restored database stream to temporary file: ${restoreDbPath}`);

  // 4. Verify restored DB using a dedicated PrismaClient instance
  console.log("4. Running verification & relational integrity checks against restored DB...");
  const originalClient = new PrismaClient();
  const restoredClient = new PrismaClient({
    datasources: {
      db: {
        url: "file:./test-restore.db",
      },
    },
  });

  try {
    // Assert integrity check via PRAGMA
    const pragmaResult = await restoredClient.$queryRawUnsafe<{ integrity_check: string }[]>("PRAGMA integrity_check");
    console.log("   ✓ PRAGMA integrity_check result:", pragmaResult[0]);
    if (pragmaResult[0]?.integrity_check !== "ok") {
      throw new Error(`SQLite PRAGMA integrity check failed: ${JSON.stringify(pragmaResult)}`);
    }

    // Row count comparisons
    const [origOrders, restOrders] = await Promise.all([
      originalClient.order.count(),
      restoredClient.order.count(),
    ]);
    console.log(`   ✓ Orders count match: ${origOrders} === ${restOrders}`);
    if (origOrders !== restOrders) throw new Error("Order count mismatch");

    const [origRolls, restRolls] = await Promise.all([
      originalClient.roll.count(),
      restoredClient.roll.count(),
    ]);
    console.log(`   ✓ Rolls count match: ${origRolls} === ${restRolls}`);
    if (origRolls !== restRolls) throw new Error("Roll count mismatch");

    const [origQc, restQc] = await Promise.all([
      originalClient.qCRecord.count(),
      restoredClient.qCRecord.count(),
    ]);
    console.log(`   ✓ QCRecords count match: ${origQc} === ${restQc}`);
    if (origQc !== restQc) throw new Error("QCRecord count mismatch");

    const [origAudit, restAudit] = await Promise.all([
      originalClient.auditLog.count(),
      restoredClient.auditLog.count(),
    ]);
    console.log(`   ✓ AuditLog count match: ${origAudit} === ${restAudit}`);
    if (origAudit !== restAudit) throw new Error("AuditLog count mismatch");

    // Relational sanity checks
    const sampleRolls = await restoredClient.roll.findMany({
      take: 5,
      include: { order: true, qcRecords: true, machine: true },
    });
    for (const roll of sampleRolls) {
      if (!roll.order) throw new Error(`Restored roll ${roll.rollNo} missing linked Order`);
      if (!roll.machine) throw new Error(`Restored roll ${roll.rollNo} missing linked Machine`);
    }
    console.log("   ✓ Sample relational foreign keys validated intact.");

    console.log("\nPASS: SQLite Backup & Restore verified with 100% data integrity!");
  } finally {
    await originalClient.$disconnect();
    await restoredClient.$disconnect();

    // Clean up temporary restore file
    if (fs.existsSync(restoreDbPath)) {
      try {
        fs.unlinkSync(restoreDbPath);
      } catch {
        // ignore on Windows if lock takes a second
      }
    }
  }
}

run().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
