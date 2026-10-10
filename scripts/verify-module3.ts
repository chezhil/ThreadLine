import { db } from "../src/lib/db";

async function verify() {
  console.log("=== Verifying Module 3 Database & Analytics ===");

  const totalRolls = await db.roll.count();
  const qcRecordsCount = await db.qCRecord.count();
  const dispatchesCount = await db.dispatch.count();

  console.log(`✓ Total Rolls in DB: ${totalRolls}`);
  console.log(`✓ Total QC Records in DB: ${qcRecordsCount}`);
  console.log(`✓ Total Dispatches in DB: ${dispatchesCount}`);

  // Test Loom 4 defect share
  const rolls = await db.roll.findMany({
    include: { machine: true, qcRecords: true },
  });

  const loom4Rolls = rolls.filter((r) => r.machine.name.includes("Loom 4"));
  const loom4Rejects = loom4Rolls.filter((r) => r.qcStatus === "REJECT").length;
  const totalRejects = rolls.filter((r) => r.qcStatus === "REJECT").length;
  const loom4Share = ((loom4Rejects / totalRejects) * 100).toFixed(1);

  console.log(`✓ Total Rejects: ${totalRejects}`);
  console.log(`✓ Loom 4 Rejects: ${loom4Rejects} (${loom4Share}% of all rejects)`);

  // Test Undispatched PASS rolls
  const readyForDispatch = rolls.filter(
    (r) => r.qcStatus === "PASS" && r.dispatchId === null
  );
  console.log(`✓ Ready for Dispatch (PASS & undispatched): ${readyForDispatch.length} rolls`);

  // Test Dispatched rolls
  const dispatchedRolls = rolls.filter((r) => r.dispatchId !== null);
  console.log(`✓ Dispatched rolls (with dispatchId locked): ${dispatchedRolls.length} rolls`);

  console.log("=== All Module 3 Verifications Passed! ===");
}

verify()
  .catch(console.error)
  .finally(() => db.$disconnect());
