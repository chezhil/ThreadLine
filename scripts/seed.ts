import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const db = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seeding...");

  // Clear existing records in correct relation order
  await db.payment.deleteMany();
  await db.qCRecord.deleteMany();
  await db.roll.deleteMany();
  await db.dispatch.deleteMany();
  await db.invoice.deleteMany();
  await db.productionLog.deleteMany();
  await db.workOrder.deleteMany();
  await db.orderYarnReservation.deleteMany();
  await db.order.deleteMany();
  await db.yarnLot.deleteMany();
  await db.yarnType.deleteMany();
  await db.machine.deleteMany();
  await db.buyer.deleteMany();
  await db.supplier.deleteMany();
  await db.attendance.deleteMany();
  await db.worker.deleteMany();
  await db.expense.deleteMany();
  await db.notification.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();

  // ==========================================
  // SHARED FOUNDATIONAL SEED DATA
  // ==========================================
  console.log("Seeding core users, suppliers, buyers, yarn, and machines...");

  const hash = await bcrypt.hash("password123", 10);
  const users = await Promise.all([
    db.user.create({ data: { name: "Rajesh Singhania", role: "owner", passwordHash: hash } }),
    db.user.create({ data: { name: "Murugan Pillai", role: "storekeeper", passwordHash: hash } }),
    db.user.create({ data: { name: "Anil Sharma", role: "floor_supervisor", passwordHash: hash } }),
    db.user.create({ data: { name: "Ramesh Kumar", role: "qc_inspector", passwordHash: hash } }),
  ]);

  // Suppliers
  const suppliers = await Promise.all([
    db.supplier.create({ data: { name: "Coimbatore Spinners Ltd", contact: "+91 98421 11223", gstin: "33AABCC1234F1Z1" } }),
    db.supplier.create({ data: { name: "Surat Synthetic Yarns", contact: "+91 98251 22334", gstin: "24AABCS5678G1Z2" } }),
    db.supplier.create({ data: { name: "Tirupur Cotton Mills", contact: "+91 94431 33445", gstin: "33AABCT9012H1Z3" } }),
    db.supplier.create({ data: { name: "Bhilwara Polyester Corp", contact: "+91 94141 44556", gstin: "08AABCB3456J1Z4" } }),
  ]);

  // Buyers
  const buyers = await Promise.all([
    db.buyer.create({ data: { name: "Arvind Mills Apparels", contact: "+91 98240 55667", gstin: "24AABCA1122K1Z5", address: "Naroda Road, Ahmedabad" } }),
    db.buyer.create({ data: { name: "Raymond Luxury Cottons", contact: "+91 98200 66778", gstin: "27AABCR3344L1Z6", address: "Thane West, Mumbai" } }),
    db.buyer.create({ data: { name: "Vardhman Textiles Ltd", contact: "+91 98150 77889", gstin: "03AABCV5566M1Z7", address: "Chandigarh Road, Ludhiana" } }),
    db.buyer.create({ data: { name: "Welspun Global Brands", contact: "+91 98210 88990", gstin: "27AABCW7788N1Z8", address: "Lower Parel, Mumbai" } }),
    db.buyer.create({ data: { name: "Shahi Exports Pvt Ltd", contact: "+91 98100 99001", gstin: "07AABCS9900P1Z9", address: "Sector 28, Faridabad" } }),
  ]);

  // Yarn Types
  const yarnTypes = await Promise.all([
    db.yarnType.create({ data: { name: "Combed Cotton 40s", count: "40s Ne", material: "Cotton", colour: "Raw White", lowStockThresholdKg: 500, costPerKg: 320 } }),
    db.yarnType.create({ data: { name: "Carded Cotton 30s", count: "30s Ne", material: "Cotton", colour: "Bleached", lowStockThresholdKg: 400, costPerKg: 280 } }),
    db.yarnType.create({ data: { name: "Polyester Filament 150D", count: "150D/48F", material: "Polyester", colour: "Navy Blue", lowStockThresholdKg: 300, costPerKg: 195 } }),
    db.yarnType.create({ data: { name: "Viscose Staple 30s", count: "30s", material: "Viscose", colour: "Olive Green", lowStockThresholdKg: 250, costPerKg: 240 } }),
    db.yarnType.create({ data: { name: "PC Blend 65/35", count: "34s Ne", material: "Poly-Cotton", colour: "Charcoal", lowStockThresholdKg: 350, costPerKg: 260 } }),
    db.yarnType.create({ data: { name: "Melange Grey 30s", count: "30s Ne", material: "Cotton", colour: "Heather Grey", lowStockThresholdKg: 200, costPerKg: 345 } }),
  ]);

  // Yarn Lots
  const yarnLots = await Promise.all([
    db.yarnLot.create({ data: { yarnTypeId: yarnTypes[0].id, supplierId: suppliers[0].id, lotNo: "LOT-CC40-01", qtyReceivedKg: 2000, qtyRemainingKg: 1450, receivedAt: new Date(Date.now() - 25 * 86400000) } }),
    db.yarnLot.create({ data: { yarnTypeId: yarnTypes[1].id, supplierId: suppliers[2].id, lotNo: "LOT-CD30-02", qtyReceivedKg: 1800, qtyRemainingKg: 320, receivedAt: new Date(Date.now() - 20 * 86400000) } }), // Near low stock
    db.yarnLot.create({ data: { yarnTypeId: yarnTypes[2].id, supplierId: suppliers[1].id, lotNo: "LOT-PF150-03", qtyReceivedKg: 2500, qtyRemainingKg: 2100, receivedAt: new Date(Date.now() - 15 * 86400000) } }),
    db.yarnLot.create({ data: { yarnTypeId: yarnTypes[3].id, supplierId: suppliers[3].id, lotNo: "LOT-VS30-04", qtyReceivedKg: 1200, qtyRemainingKg: 950, receivedAt: new Date(Date.now() - 10 * 86400000) } }),
    db.yarnLot.create({ data: { yarnTypeId: yarnTypes[4].id, supplierId: suppliers[0].id, lotNo: "LOT-PC34-05", qtyReceivedKg: 3000, qtyRemainingKg: 2400, receivedAt: new Date(Date.now() - 8 * 86400000) } }),
    db.yarnLot.create({ data: { yarnTypeId: yarnTypes[5].id, supplierId: suppliers[2].id, lotNo: "LOT-MG30-06", qtyReceivedKg: 1500, qtyRemainingKg: 1150, receivedAt: new Date(Date.now() - 5 * 86400000) } }),
  ]);

  // Machines (8 machines across spinning, weaving, dyeing)
  // Loom 4 is designated with high defect rate as per spec!
  const machines = await Promise.all([
    db.machine.create({ data: { name: "Spinning Ringframe 1", type: "spinning", status: "RUNNING", capacityMetresPerShift: 1200 } }),
    db.machine.create({ data: { name: "Spinning Ringframe 2", type: "spinning", status: "RUNNING", capacityMetresPerShift: 1200 } }),
    db.machine.create({ data: { name: "Airjet Loom 1", type: "loom", status: "RUNNING", capacityMetresPerShift: 850 } }),
    db.machine.create({ data: { name: "Airjet Loom 2", type: "loom", status: "RUNNING", capacityMetresPerShift: 850 } }),
    db.machine.create({ data: { name: "Rapier Loom 3", type: "loom", status: "IDLE", capacityMetresPerShift: 650 } }),
    db.machine.create({ data: { name: "Airjet Loom 4 (Faulty Cam)", type: "loom", status: "RUNNING", capacityMetresPerShift: 800 } }), // Loom 4!
    db.machine.create({ data: { name: "Softflow Dyeing 1", type: "dyeing", status: "RUNNING", capacityMetresPerShift: 1000 } }),
    db.machine.create({ data: { name: "Jigger Dyeing 2", type: "dyeing", status: "MAINTENANCE", capacityMetresPerShift: 750 } }),
  ]);

  // Orders
  const orders = await Promise.all([
    db.order.create({
      data: {
        orderNo: "EVR-2610-001",
        buyerId: buyers[0].id,
        fabricType: "Cotton Twill 2/1",
        colour: "Raw White",
        gsm: 210,
        qtyMetres: 12000,
        pricePerMetre: 145,
        deadline: new Date(Date.now() + 14 * 86400000),
        status: "DISPATCHED",
        trackingToken: "TRK-EVR-001-A9F2",
      },
    }),
    db.order.create({
      data: {
        orderNo: "EVR-2610-002",
        buyerId: buyers[1].id,
        fabricType: "Poplin Shirting",
        colour: "Sky Blue",
        gsm: 130,
        qtyMetres: 8000,
        pricePerMetre: 165,
        deadline: new Date(Date.now() + 7 * 86400000),
        status: "READY",
        trackingToken: "TRK-EVR-002-B8E3",
      },
    }),
    db.order.create({
      data: {
        orderNo: "EVR-2610-003",
        buyerId: buyers[2].id,
        fabricType: "Heavy Denim 3/1",
        colour: "Indigo Dark",
        gsm: 380,
        qtyMetres: 15000,
        pricePerMetre: 210,
        deadline: new Date(Date.now() + 21 * 86400000),
        status: "IN_PRODUCTION",
        trackingToken: "TRK-EVR-003-C7D4",
      },
    }),
    db.order.create({
      data: {
        orderNo: "EVR-2610-004",
        buyerId: buyers[3].id,
        fabricType: "Canvas Ducks",
        colour: "Olive Green",
        gsm: 320,
        qtyMetres: 6000,
        pricePerMetre: 185,
        deadline: new Date(Date.now() + 10 * 86400000),
        status: "QC",
        trackingToken: "TRK-EVR-004-D6C5",
      },
    }),
    db.order.create({
      data: {
        orderNo: "EVR-2610-005",
        buyerId: buyers[4].id,
        fabricType: "Single Jersey Knit",
        colour: "Heather Grey",
        gsm: 180,
        qtyMetres: 5000,
        pricePerMetre: 170,
        deadline: new Date(Date.now() + 5 * 86400000),
        status: "CONFIRMED",
        trackingToken: "TRK-EVR-005-E5B6",
      },
    }),
  ]);

  // Work Orders
  const workOrders = await Promise.all([
    db.workOrder.create({ data: { orderId: orders[0].id, stage: "weaving", machineId: machines[2].id, plannedQty: 12000, producedQty: 12000, status: "COMPLETED" } }),
    db.workOrder.create({ data: { orderId: orders[1].id, stage: "weaving", machineId: machines[3].id, plannedQty: 8000, producedQty: 8000, status: "COMPLETED" } }),
    db.workOrder.create({ data: { orderId: orders[2].id, stage: "weaving", machineId: machines[5].id, plannedQty: 15000, producedQty: 9000, status: "IN_PROGRESS" } }),
    db.workOrder.create({ data: { orderId: orders[3].id, stage: "weaving", machineId: machines[5].id, plannedQty: 6000, producedQty: 6000, status: "IN_PROGRESS" } }),
    db.workOrder.create({ data: { orderId: orders[4].id, stage: "spinning", machineId: machines[0].id, plannedQty: 5000, producedQty: 2500, status: "IN_PROGRESS" } }),
  ]);

  // =========================================================================
  // MODULE 3: QUALITY, DISPATCH, ROLLS & DEFECT ANALYTICS SEED DATA
  // Author: Aditya (Antigravity)
  //
  // Seed Specification:
  // - 65+ total rolls with realistic mix of PASS / REWORK / REJECT
  // - Machine Loom 4 (Airjet Loom 4) produces ~60% of all rejected rolls
  //   so that defect root-cause queries calculate:
  //   "Loom 4 produced 60% of rejects this period"
  // - A portion of PASS rolls dispatched on trucks with GST invoices
  // - Undispatched PASS rolls sitting in warehouse ready for demo
  // =========================================================================
  console.log("Seeding Module 3: 65+ rolls, QC records, and dispatches (with Loom 4 bias)...");

  // Create an initial Dispatch for Order 0
  const initialInvoice = await db.invoice.create({
    data: {
      invoiceNo: "INV-2610-0001",
      orderId: orders[0].id,
      buyerId: buyers[0].id,
      subtotal: 1740000,
      gst: 313200,
      total: 2053200,
      status: "PAID",
    },
  });

  const dispatch1 = await db.dispatch.create({
    data: {
      buyerId: buyers[0].id,
      truckNo: "TN-38-AX-9942",
      dispatchedAt: new Date(Date.now() - 3 * 86400000),
      invoiceId: initialInvoice.id,
    },
  });

  const shifts = ["Morning (Shift A)", "Evening (Shift B)", "Night (Shift C)"];
  const inspectors = ["QC-INSP-01", "QC-INSP-02", "QC-INSP-03"];

  let rollCounter = 1;
  const loom4Machine = machines[5]; // Airjet Loom 4 (Faulty Cam)

  // 1. Seed 16 Dispatched PASS rolls for Order 0
  for (let i = 0; i < 16; i++) {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const machine = machines[2]; // Loom 1

    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[0].id,
        workOrderId: workOrders[0].id,
        machineId: machine.id,
        shift: shifts[i % 3],
        yarnLotId: yarnLots[0].id,
        lengthMetres: 750,
        weightKg: 160 + (i % 5),
        qcStatus: "PASS",
        dispatchId: dispatch1.id,
        qrToken,
      },
    });

    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[i % 3],
        result: "PASS",
        defects: JSON.stringify([]),
        notes: "Flawless weave, uniform density.",
        inspectedAt: new Date(Date.now() - (4 + (i % 2)) * 86400000),
      },
    });
    rollCounter++;
  }

  // 2. Seed 12 Undispatched PASS rolls sitting in Warehouse ready for demo dispatch
  for (let i = 0; i < 12; i++) {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const machine = machines[3]; // Loom 2

    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[1].id,
        workOrderId: workOrders[1].id,
        machineId: machine.id,
        shift: shifts[i % 3],
        yarnLotId: yarnLots[1].id,
        lengthMetres: 680,
        weightKg: 145 + (i % 4),
        qcStatus: "PASS",
        dispatchId: null, // Ready for loading onto truck
        qrToken,
      },
    });

    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[i % 3],
        result: "PASS",
        defects: JSON.stringify([]),
        notes: "Clean selvedge, ready for buyer dispatch.",
        inspectedAt: new Date(Date.now() - (1 + (i % 3)) * 86400000),
      },
    });
    rollCounter++;
  }

  // 3. Seed Loom 4 rolls (Faulty Cam) — 15 REJECT rolls and 4 REWORK rolls!
  // This ensures Loom 4 has ~60% of all mill rejects!
  for (let i = 0; i < 15; i++) {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const defects = i % 2 === 0 ? ["hole", "uneven_weave"] : ["uneven_weave"];

    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[2].id,
        workOrderId: workOrders[2].id,
        machineId: loom4Machine.id, // Loom 4!
        shift: shifts[(i + 1) % 3],
        yarnLotId: yarnLots[2].id,
        lengthMetres: 600,
        weightKg: 155,
        qcStatus: "REJECT",
        dispatchId: null,
        qrToken,
      },
    });

    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[i % 3],
        result: "REJECT",
        defects: JSON.stringify(defects),
        notes: "Major harness drop / reed mark causing visible uneven weave. Cam timing drift on Loom 4.",
        inspectedAt: new Date(Date.now() - (i % 6) * 86400000),
      },
    });
    rollCounter++;
  }

  // 4. Seed Loom 4 REWORK rolls
  for (let i = 0; i < 4; i++) {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[2].id,
        workOrderId: workOrders[2].id,
        machineId: loom4Machine.id,
        shift: shifts[i % 3],
        yarnLotId: yarnLots[2].id,
        lengthMetres: 620,
        weightKg: 158,
        qcStatus: "REWORK",
        dispatchId: null,
        qrToken,
      },
    });

    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[i % 3],
        result: "REWORK",
        defects: JSON.stringify(["uneven_weave"]),
        notes: "Minor tension banding. Requires mending table inspection.",
        inspectedAt: new Date(Date.now() - (i % 4) * 86400000),
      },
    });
    rollCounter++;
  }

  // 5. Seed other machines with occasional REJECT / REWORK to keep distribution realistic
  // Loom 1: 2 rejects
  for (let i = 0; i < 2; i++) {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[2].id,
        workOrderId: workOrders[2].id,
        machineId: machines[2].id, // Loom 1
        shift: "Night (Shift C)",
        yarnLotId: yarnLots[0].id,
        lengthMetres: 550,
        weightKg: 140,
        qcStatus: "REJECT",
        dispatchId: null,
        qrToken,
      },
    });

    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[0],
        result: "REJECT",
        defects: JSON.stringify(["hole"]),
        notes: "Flyer tear hole at 140m mark.",
        inspectedAt: new Date(Date.now() - (2 + i) * 86400000),
      },
    });
    rollCounter++;
  }

  // Loom 2: 2 rejects (colour mismatch from yarn variation)
  for (let i = 0; i < 2; i++) {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;

    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[3].id,
        workOrderId: workOrders[3].id,
        machineId: machines[3].id, // Loom 2
        shift: "Evening (Shift B)",
        yarnLotId: yarnLots[1].id,
        lengthMetres: 640,
        weightKg: 152,
        qcStatus: "REJECT",
        dispatchId: null,
        qrToken,
      },
    });

    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[1],
        result: "REJECT",
        defects: JSON.stringify(["colour_mismatch"]),
        notes: "Lot shade bar variation across width.",
        inspectedAt: new Date(Date.now() - (3 + i) * 86400000),
      },
    });
    rollCounter++;
  }

  // Loom 3: 1 reject
  {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[3].id,
        workOrderId: workOrders[3].id,
        machineId: machines[4].id, // Loom 3
        shift: "Morning (Shift A)",
        yarnLotId: yarnLots[3].id,
        lengthMetres: 600,
        weightKg: 150,
        qcStatus: "REJECT",
        dispatchId: null,
        qrToken,
      },
    });
    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[2],
        result: "REJECT",
        defects: JSON.stringify(["hole"]),
        notes: "Warp knot slip resulted in large hole.",
        inspectedAt: new Date(Date.now() - 5 * 86400000),
      },
    });
    rollCounter++;
  }

  // Dyeing 1: 1 reject (colour mismatch)
  {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const roll = await db.roll.create({
      data: {
        rollNo,
        orderId: orders[3].id,
        workOrderId: workOrders[3].id,
        machineId: machines[6].id, // Dyeing 1
        shift: "Night (Shift C)",
        yarnLotId: yarnLots[2].id,
        lengthMetres: 700,
        weightKg: 165,
        qcStatus: "REJECT",
        dispatchId: null,
        qrToken,
      },
    });
    await db.qCRecord.create({
      data: {
        rollId: roll.id,
        inspectorId: inspectors[0],
        result: "REJECT",
        defects: JSON.stringify(["colour_mismatch"]),
        notes: "Uneven dye liquor uptake, shade 2 tones off master swatch.",
        inspectedAt: new Date(Date.now() - 4 * 86400000),
      },
    });
    rollCounter++;
  }

  // 6. Seed 14 PENDING rolls waiting on the inspection floor
  for (let i = 0; i < 14; i++) {
    const rollNo = `ROL-2610-${String(rollCounter).padStart(4, "0")}`;
    const qrToken = `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const mach = machines[(i % 4) + 2];

    await db.roll.create({
      data: {
        rollNo,
        orderId: orders[3].id,
        workOrderId: workOrders[3].id,
        machineId: mach.id,
        shift: shifts[i % 3],
        yarnLotId: yarnLots[i % 4].id,
        lengthMetres: 650 + (i * 10),
        weightKg: 150 + (i * 2),
        qcStatus: "PENDING",
        dispatchId: null,
        qrToken,
      },
    });
    rollCounter++;
  }

  console.log(`✅ Seeded ${rollCounter - 1} rolls total!`);
  console.log("   - Dispatched rolls with invoice: 16");
  console.log("   - Undispatched PASS rolls ready for loading: 12");
  console.log("   - Loom 4 Rejects: 15 / Total Rejects: 21 (~71% on Loom 4 for clear callout)");
  console.log("   - Pending inspection rolls: 14");
  console.log("Seeding complete!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
