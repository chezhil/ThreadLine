import type { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import { computeInvoiceTotals } from "../src/lib/billing";

// ---------------------------------------------------------------------------
// Module 3 (Aditya) — rolls, QC records, dispatches and their invoices, built
// on the orders, machines and yarn lots seeded by Modules 1 and 2.
//
// Integration port of Module 3's standalone seed (which wiped the database and
// created its own users, buyers, orders and machines). The demo story is kept:
// 80+ rolls, a mix of PASS / REWORK / REJECT, Loom 4 (now in breakdown) behind
// ~70% of all rejects, trucks already dispatched with GST invoices, PASS rolls
// waiting in the warehouse for a demo dispatch, and rolls pending inspection.
//
// To make costing and machine output line up, every roll comes from a
// weaving work order with production logs on the machine and day it was made.
//
// Idempotent: does nothing if any roll exists.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SHIFTS = [
  { name: "Morning (Shift A)", hour: 13 },
  { name: "Evening (Shift B)", hour: 21 },
  { name: "Night (Shift C)", hour: 23.5 },
];
const FABRIC_WIDTH_M = 1.0; // roll weight = metres × GSM × width

/** `hour` (IST, may be fractional) on the day `daysAgo` days before today. */
function istAt(daysAgo: number, hour: number, now: Date): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const midnightUtc = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  const at = new Date(midnightUtc - IST_OFFSET_MS - daysAgo * DAY_MS + hour * 60 * 60 * 1000);
  return at.getTime() > now.getTime() ? now : at;
}

function isSunday(daysAgo: number, now: Date): boolean {
  return new Date(istAt(daysAgo, 12, now).getTime() + IST_OFFSET_MS).getUTCDay() === 0;
}

type Segment = {
  machine: string;
  /** Day (days ago) weaving starts; one shift's output is logged per working day from there. */
  startDay: number;
  /** Working days (Sundays skipped) the segment's metres are spread over. */
  days: number;
  pass?: number;
  rework?: number;
  reject?: number;
  pending?: number;
  /** Defects recorded on this segment's REJECT/REWORK rolls, cycled. */
  defects?: string[][];
  note?: string;
};

type Plan = {
  status: string;
  /** Which order with that status (0 = first by order no.). */
  nth: number;
  segments: Segment[];
  /** Days ago the PASS rolls left on a truck; omitted = still in the warehouse. */
  dispatchDay?: number;
  truckNo?: string;
};

const LOOM4_NOTE = "Cam timing drift on Loom 4: harness drop / reed marks causing uneven weave.";

const PLANS: Plan[] = [
  {
    status: "CLOSED",
    nth: 1,
    dispatchDay: 19,
    truckNo: "TN-38-AX-9942",
    segments: [
      { machine: "Loom 4", startDay: 30, days: 3, pass: 3, reject: 2, defects: [["hole", "uneven_weave"], ["uneven_weave"]], note: LOOM4_NOTE },
      { machine: "Loom 3", startDay: 28, days: 7, pass: 14 },
    ],
  },
  {
    status: "CLOSED",
    nth: 0,
    dispatchDay: 15,
    truckNo: "TN-39-BK-4410",
    segments: [
      { machine: "Loom 4", startDay: 26, days: 3, pass: 4, reject: 2, defects: [["uneven_weave"], ["hole", "uneven_weave"]], note: LOOM4_NOTE },
      { machine: "Loom 1", startDay: 24, days: 6, pass: 11, reject: 1, defects: [["hole"]], note: "Flyer tear hole at the 40 m mark." },
    ],
  },
  {
    status: "DISPATCHED",
    nth: 0,
    dispatchDay: 3,
    truckNo: "GJ-05-CT-7781",
    segments: [
      { machine: "Loom 4", startDay: 17, days: 3, pass: 4, reject: 2, defects: [["uneven_weave"], ["hole", "uneven_weave"]], note: LOOM4_NOTE },
      { machine: "Loom 2", startDay: 16, days: 6, pass: 10 },
    ],
  },
  {
    status: "READY",
    nth: 0,
    segments: [
      { machine: "Loom 4", startDay: 12, days: 3, pass: 3, reject: 1, rework: 2, defects: [["uneven_weave"]], note: "Tension banding; Loom 4 cam drift again." },
      { machine: "Loom 2", startDay: 9, days: 6, pass: 9, reject: 1, defects: [["colour_mismatch"]], note: "Lot shade bar variation across the width." },
    ],
  },
  {
    status: "QC",
    nth: 0,
    segments: [{ machine: "Loom 3", startDay: 2, days: 1, pass: 2, reject: 1, pending: 8, defects: [["hole"]], note: "Warp knot slip left a large hole." }],
  },
  {
    status: "IN_PRODUCTION",
    nth: 1,
    segments: [{ machine: "Loom 1", startDay: 0, days: 1, pending: 2 }],
  },
];

export async function seedQuality(db: PrismaClient, now = new Date()) {
  if ((await db.roll.count()) > 0) {
    console.log("  Module 3: rolls already present, skipping.");
    return;
  }
  console.log("Seeding Module 3: rolls, QC records, dispatches (Loom 4 reject cluster)...");

  const machines = new Map((await db.machine.findMany()).map((m) => [m.name, m]));
  const lots = await db.yarnLot.findMany({ orderBy: { lotNo: "asc" } });
  const inspector = await db.user.findFirst({ where: { role: "qc_inspector" } });
  const supervisor = await db.user.findFirst({ where: { role: "floor_supervisor" } });
  if (!lots.length || !inspector || !supervisor) {
    console.log("  Module 3: needs yarn lots, a QC inspector and a floor supervisor first, skipping.");
    return;
  }

  let rollSeq = 0;
  let rollCount = 0;
  let dispatchCount = 0;

  for (const plan of PLANS) {
    const order = (
      await db.order.findMany({ where: { status: plan.status }, orderBy: { orderNo: "asc" }, include: { invoices: true } })
    )[plan.nth];
    if (!order) continue;
    const lot = lots[rollSeq % lots.length];
    const passRollIds: string[] = [];
    let lastProducedDay = 0;

    for (const seg of plan.segments) {
      const machine = machines.get(seg.machine);
      if (!machine) continue;
      const counts = { PASS: seg.pass ?? 0, REWORK: seg.rework ?? 0, REJECT: seg.reject ?? 0, PENDING: seg.pending ?? 0 };
      const total = counts.PASS + counts.REWORK + counts.REJECT + counts.PENDING;
      const lengths = Array.from({ length: total }, (_, i) => 95 + ((rollSeq + i) * 7) % 16);
      const metres = lengths.reduce((s, l) => s + l, 0);

      // Weaving work order on this machine (reuse Module 2's if it seeded one).
      let workOrder = await db.workOrder.findFirst({ where: { orderId: order.id, stage: "weaving", machineId: machine.id } });
      const shiftsUsed: { day: number; shift: (typeof SHIFTS)[number] }[] = [];
      if (!workOrder) {
        const perDay = Math.min(Math.ceil(metres / seg.days), Math.round(machine.capacityMetresPerShift * 0.95));
        let remaining = metres;
        let day = seg.startDay;
        const logs: { qty: number; at: Date; shift: string }[] = [];
        while (remaining > 0) {
          if (isSunday(day, now)) {
            day = Math.max(0, day - 1);
            continue;
          }
          const shift = SHIFTS[logs.length % 2]; // alternate Morning / Evening
          const qty = Math.min(perDay, remaining);
          logs.push({ qty, at: istAt(day, shift.hour, now), shift: shift.name });
          shiftsUsed.push({ day, shift });
          remaining -= qty;
          day = Math.max(0, day - 1);
        }
        const done = counts.PENDING === 0;
        workOrder = await db.workOrder.create({
          data: {
            orderId: order.id,
            stage: "weaving",
            machineId: machine.id,
            plannedQty: metres,
            producedQty: metres,
            status: done ? "COMPLETED" : "IN_PROGRESS",
            startedAt: logs[0].at,
            finishedAt: done ? logs[logs.length - 1].at : null,
          },
        });
        for (const l of logs) {
          await db.productionLog.create({
            data: { workOrderId: workOrder.id, machineId: machine.id, shift: l.shift, qtyProduced: l.qty, loggedAt: l.at, loggedBy: supervisor.id },
          });
        }
      } else {
        shiftsUsed.push({ day: seg.startDay, shift: SHIFTS[0] });
      }
      const endDay = shiftsUsed[shiftsUsed.length - 1].day;
      lastProducedDay = Math.max(lastProducedDay, endDay);

      const results = [
        ...Array(counts.PASS).fill("PASS"),
        ...Array(counts.REWORK).fill("REWORK"),
        ...Array(counts.REJECT).fill("REJECT"),
        ...Array(counts.PENDING).fill("PENDING"),
      ] as string[];
      let defectIdx = 0;
      for (const [i, result] of results.entries()) {
        rollSeq++;
        const made = shiftsUsed[Math.min(shiftsUsed.length - 1, Math.floor((i * shiftsUsed.length) / results.length))];
        const length = lengths[i];
        const roll = await db.roll.create({
          data: {
            rollNo: `ROL-2610-${String(rollSeq).padStart(4, "0")}`,
            orderId: order.id,
            workOrderId: workOrder.id,
            machineId: machine.id,
            shift: made.shift.name,
            yarnLotId: lot.id,
            lengthMetres: length,
            weightKg: Math.round(((length * order.gsm * FABRIC_WIDTH_M) / 1000) * 10) / 10,
            qcStatus: result,
            qrToken: `TL-ROLL-${crypto.randomBytes(8).toString("hex").toUpperCase()}`,
          },
        });
        rollCount++;
        if (result === "PASS") passRollIds.push(roll.id);
        if (result === "PENDING") continue;
        const defects = result === "PASS" ? [] : (seg.defects ?? [["uneven_weave"]])[defectIdx++ % (seg.defects?.length ?? 1)];
        await db.qCRecord.create({
          data: {
            rollId: roll.id,
            inspectorId: inspector.id,
            result,
            defects: JSON.stringify(defects),
            notes: result === "PASS" ? "Clean selvedge, uniform density." : seg.note ?? null,
            inspectedAt: istAt(Math.max(0, made.day - 1), 11, now),
          },
        });
      }
    }

    // Trucks already gone: invoice (Module 1's GST helper) + dispatch.
    if (plan.dispatchDay !== undefined && passRollIds.length) {
      const dispatchedAt = istAt(plan.dispatchDay, 16, now);
      let invoice = order.invoices[0];
      if (!invoice) {
        const yymm = new Date(dispatchedAt.getTime() + IST_OFFSET_MS).toISOString().slice(2, 7).replace("-", "");
        let seq = (await db.invoice.count()) + 1;
        while (await db.invoice.findUnique({ where: { invoiceNo: `INV-${yymm}-${String(seq).padStart(4, "0")}` } })) seq++;
        const subtotal = order.qtyMetres * order.pricePerMetre;
        const { gst, total } = computeInvoiceTotals(subtotal);
        invoice = await db.invoice.create({
          data: {
            invoiceNo: `INV-${yymm}-${String(seq).padStart(4, "0")}`,
            orderId: order.id,
            buyerId: order.buyerId,
            subtotal,
            gst,
            total,
            status: order.status === "CLOSED" ? "PAID" : "ISSUED",
            createdAt: dispatchedAt,
          },
        });
      }
      const dispatch = await db.dispatch.create({
        data: { buyerId: order.buyerId, truckNo: plan.truckNo ?? "TN-00-XX-0000", dispatchedAt, invoiceId: invoice.id },
      });
      await db.roll.updateMany({ where: { id: { in: passRollIds } }, data: { dispatchId: dispatch.id } });
      dispatchCount++;
    }
  }

  const rejects = await db.roll.findMany({ where: { qcStatus: "REJECT" }, include: { machine: true } });
  const loom4 = rejects.filter((r) => r.machine.name === "Loom 4").length;
  console.log(
    `  Module 3: ${rollCount} rolls, ${dispatchCount} dispatches; Loom 4 made ${loom4} of ${rejects.length} rejects (${Math.round((loom4 / Math.max(1, rejects.length)) * 100)}%).`,
  );
}
