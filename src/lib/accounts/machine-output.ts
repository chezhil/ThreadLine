import type { PrismaClient } from "@prisma/client";
import { db as defaultDb } from "../db";
import { dayRange, istDateKey } from "./period";

// Machine output and roll quality, read from Module 2's ProductionLog/Machine
// rows and Module 3's Roll/QCRecord rows. Read-only.

const DAY_MS = 24 * 60 * 60 * 1000;
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface MachineOutputRow {
  machineId: string;
  name: string;
  type: string;
  status: string;
  capacityMetresPerShift: number;
  todayOutput: number;
  periodOutput: number;
  shiftsLogged: number;
  /** Output ÷ (capacity × shifts that logged output). null when nothing logged. */
  utilisationPct: number | null;
  daily: { date: string; qty: number }[];
}

export interface MachineOutput {
  days: number;
  from: string;
  to: string;
  machines: MachineOutputRow[];
  totals: { todayOutput: number; periodOutput: number; byType: Record<string, number> };
}

export async function machineOutput(days = 7, db: PrismaClient = defaultDb, now = new Date()): Promise<MachineOutput> {
  const todayKey = istDateKey(now);
  const today = dayRange(todayKey);
  const from = new Date(today.start.getTime() - (days - 1) * DAY_MS);
  const dateKeys = Array.from({ length: days }, (_, i) => istDateKey(new Date(from.getTime() + i * DAY_MS + 1)));

  const [machines, logs] = await Promise.all([
    db.machine.findMany({ orderBy: { name: "asc" } }),
    db.productionLog.findMany({
      where: { loggedAt: { gte: from, lt: today.end } },
      select: { machineId: true, shift: true, qtyProduced: true, loggedAt: true },
    }),
  ]);

  const byMachine = new Map<string, { daily: Map<string, number>; shifts: Set<string>; total: number }>();
  for (const log of logs) {
    const m = byMachine.get(log.machineId) ?? { daily: new Map(), shifts: new Set(), total: 0 };
    const key = istDateKey(log.loggedAt);
    m.daily.set(key, (m.daily.get(key) ?? 0) + log.qtyProduced);
    m.shifts.add(`${key}|${log.shift.trim().toLowerCase()}`);
    m.total += log.qtyProduced;
    byMachine.set(log.machineId, m);
  }

  const rows: MachineOutputRow[] = machines.map((machine) => {
    const m = byMachine.get(machine.id);
    const shiftsLogged = m?.shifts.size ?? 0;
    const periodOutput = m?.total ?? 0;
    const capacity = machine.capacityMetresPerShift * shiftsLogged;
    return {
      machineId: machine.id,
      name: machine.name,
      type: machine.type,
      status: machine.status,
      capacityMetresPerShift: machine.capacityMetresPerShift,
      todayOutput: r1(m?.daily.get(todayKey) ?? 0),
      periodOutput: r1(periodOutput),
      shiftsLogged,
      utilisationPct: capacity > 0 ? r1((periodOutput / capacity) * 100) : null,
      daily: dateKeys.map((date) => ({ date, qty: r1(m?.daily.get(date) ?? 0) })),
    };
  });

  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = r1((byType[r.type] ?? 0) + r.periodOutput);

  return {
    days,
    from: dateKeys[0],
    to: todayKey,
    machines: rows,
    totals: {
      todayOutput: r1(rows.reduce((s, r) => s + r.todayOutput, 0)),
      periodOutput: r1(rows.reduce((s, r) => s + r.periodOutput, 0)),
      byType,
    },
  };
}

export interface MachineQualityRow {
  machineId: string;
  name: string;
  inspected: number;
  pass: number;
  rework: number;
  reject: number;
  rejectRatePct: number | null;
  shareOfRejectsPct: number | null;
}

/**
 * Roll QC outcomes per machine over the last `days` days (by the roll's latest
 * QC record). Rolls never inspected are left out rather than counted as passes.
 */
export async function machineQuality(days = 30, db: PrismaClient = defaultDb, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY_MS);
  const rolls = await db.roll.findMany({
    where: { qcRecords: { some: { inspectedAt: { gte: since } } } },
    select: {
      machineId: true,
      machine: { select: { name: true } },
      qcRecords: { orderBy: { inspectedAt: "desc" }, take: 1, select: { result: true } },
    },
  });
  const map = new Map<string, MachineQualityRow>();
  let totalReject = 0;
  for (const roll of rolls) {
    const result = roll.qcRecords[0]?.result;
    const row = map.get(roll.machineId) ?? {
      machineId: roll.machineId,
      name: roll.machine.name,
      inspected: 0,
      pass: 0,
      rework: 0,
      reject: 0,
      rejectRatePct: null,
      shareOfRejectsPct: null,
    };
    row.inspected++;
    if (result === "PASS") row.pass++;
    else if (result === "REWORK") row.rework++;
    else if (result === "REJECT") {
      row.reject++;
      totalReject++;
    }
    map.set(roll.machineId, row);
  }
  const machines = [...map.values()]
    .map((r) => ({
      ...r,
      rejectRatePct: r.inspected ? r1((r.reject / r.inspected) * 100) : null,
      shareOfRejectsPct: totalReject ? r1((r.reject / totalReject) * 100) : null,
    }))
    .sort((a, b) => b.reject - a.reject || a.name.localeCompare(b.name));
  return { days, rollsInspected: rolls.length, totalReject, machines };
}
