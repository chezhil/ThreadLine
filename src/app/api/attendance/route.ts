import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { attendanceBatchSchema, monthQuerySchema, SHIFTS, WAGE_FACTOR, type AttendanceStatus } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, readJson, round2, zodFieldErrors } from "@/lib/accounts/http";
import { currentMonthKey, dayRange, istDateKey, istMidnight, monthRange } from "@/lib/accounts/period";

// GET ?date=YYYY-MM-DD&shift=…  → the muster sheet for that date/shift
// GET ?month=YYYY-MM            → per-worker attendance and wages for the month
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const sp = req.nextUrl.searchParams;
  const date = sp.get("date");
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fieldErrorResponse({ date: ["Date must be YYYY-MM-DD"] });
    const shift = sp.get("shift");
    if (shift && !(SHIFTS as readonly string[]).includes(shift)) return fieldErrorResponse({ shift: ["Unknown shift"] });
    const { start, end } = dayRange(date);
    const [marks, machines] = await Promise.all([
      db.attendance.findMany({
        where: { date: { gte: start, lt: end }, ...(shift ? { shift } : {}) },
        include: { worker: { select: { name: true, role: true } } },
        orderBy: { worker: { name: "asc" } },
      }),
      // Machines to assign operators to (read-only; Module 2 owns the table).
      db.machine.findMany({ select: { id: true, name: true, type: true, status: true }, orderBy: { name: "asc" } }),
    ]);
    return NextResponse.json({ date, shift, marks, machines });
  }

  const monthParsed = monthQuerySchema.safeParse(sp.get("month") ?? undefined);
  if (!monthParsed.success) return fieldErrorResponse(zodFieldErrors(monthParsed.error));
  const month = monthParsed.data ?? currentMonthKey();
  const { start, end } = monthRange(month);

  const [workers, marks] = await Promise.all([
    db.worker.findMany({ orderBy: { name: "asc" } }),
    db.attendance.findMany({ where: { date: { gte: start, lt: end } }, select: { workerId: true, status: true, date: true, dailyWage: true } }),
  ]);
  const rows = workers.map((w) => {
    const mine = marks.filter((m) => m.workerId === w.id);
    const count = (s: AttendanceStatus) => mine.filter((m) => m.status === s).length;
    // Each mark at the wage that applied that day (a raise isn't retroactive).
    const wages = mine.reduce((s, m) => s + (m.dailyWage ?? w.dailyWage) * (WAGE_FACTOR[m.status as AttendanceStatus] ?? 0), 0);
    return {
      workerId: w.id,
      name: w.name,
      role: w.role,
      dailyWage: w.dailyWage,
      present: count("present"),
      halfDay: count("half_day"),
      absent: count("absent"),
      daysMarked: new Set(mine.map((m) => istDateKey(m.date))).size,
      wages: round2(wages),
    };
  });
  return NextResponse.json({
    month,
    rows,
    totals: {
      wages: round2(rows.reduce((s, r) => s + r.wages, 0)),
      present: rows.reduce((s, r) => s + r.present, 0),
      halfDay: rows.reduce((s, r) => s + r.halfDay, 0),
      absent: rows.reduce((s, r) => s + r.absent, 0),
    },
  });
}

// Saves a whole muster sheet. A worker already marked for this date and shift
// is updated (and the change audited) rather than marked twice.
export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = attendanceBatchSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { shift, entries } = parsed.data;
  const date = istMidnight(parsed.data.date);

  const workerIds = entries.map((e) => e.workerId);
  const machineIds = [...new Set(entries.map((e) => e.machineId).filter((m): m is string => !!m))];
  const [workers, machines] = await Promise.all([
    db.worker.findMany({ where: { id: { in: workerIds } }, select: { id: true, dailyWage: true } }),
    db.machine.findMany({ where: { id: { in: machineIds } }, select: { id: true } }),
  ]);
  const knownWorkers = new Set(workers.map((w) => w.id));
  const wageOf = new Map(workers.map((w) => [w.id, w.dailyWage]));
  const knownMachines = new Set(machines.map((m) => m.id));
  const errors: Record<string, string[]> = {};
  entries.forEach((e, i) => {
    if (!knownWorkers.has(e.workerId)) errors[`entries.${i}.workerId`] = ["Worker not found"];
    if (e.machineId && !knownMachines.has(e.machineId)) errors[`entries.${i}.machineId`] = ["Machine not found"];
  });
  if (Object.keys(errors).length) return fieldErrorResponse(errors);

  const { start, end } = dayRange(istDateKey(date));

  // The existing-marks lookup runs inside the write transaction (serialised
  // by writeTransaction), and (workerId, date, shift) is unique, so two saves
  // of the same muster at once update one row instead of marking twice.
  const audits: Parameters<typeof logAudit>[] = [];
  let created = 0;
  let updated = 0;
  await writeTransaction(async (tx) => {
    const existing = await tx.attendance.findMany({
      where: { workerId: { in: workerIds }, shift, date: { gte: start, lt: end } },
    });
    const byWorker = new Map(existing.map((a) => [a.workerId, a]));
    for (const e of entries) {
      const prev = byWorker.get(e.workerId);
      if (prev) {
        if (prev.status === e.status && (prev.machineId ?? null) === e.machineId) continue;
        const next = await tx.attendance.update({
          where: { id: prev.id },
          data: { status: e.status, machineId: e.machineId },
        });
        audits.push(["Attendance", prev.id, "update", prev, next, user.id]);
        updated++;
      } else {
        const next = await tx.attendance.create({
          data: { workerId: e.workerId, date, shift, status: e.status, machineId: e.machineId, dailyWage: wageOf.get(e.workerId) },
        });
        byWorker.set(e.workerId, next);
        audits.push(["Attendance", next.id, "create", null, next, user.id]);
        created++;
      }
    }
  });
  for (const a of audits) await logAudit(...a);

  return NextResponse.json({ created, updated, unchanged: entries.length - created - updated }, { status: 201 });
}
