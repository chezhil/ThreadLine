// Target entities the Data Import feature can write to. Each target defines
// the fields a row needs (for the SQL column-mapping UI and the OCR prompt)
// and a commitRow() that resolves/creates related records by name, validates,
// writes through the normal db calls, and audits — the same way the regular
// forms do. Nothing here bypasses validation; it just accepts names instead
// of ids and looks the ids up (or creates the record) first.
import type { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emit, RealtimeEvents } from "@/lib/realtime";
import { checkLowStockAndNotify } from "@/lib/inventory";
import { generateOrderNo, generateTrackingToken } from "@/lib/order-numbers";
import { dayRange, istDateKey, istMidnight } from "@/lib/accounts/period";
import { ATTENDANCE_STATUSES, EXPENSE_CATEGORIES, SHIFTS, WORKER_ROLES, type AttendanceStatus } from "@/lib/validation/accounts";

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  example: string;
}

export interface CommitResult {
  ok: boolean;
  summary: string;
}

export interface ImportTarget {
  key: string;
  label: string;
  description: string;
  fields: ImportField[];
  commitRow(row: Record<string, string>, userId: string): Promise<CommitResult>;
}

function need(row: Record<string, string>, field: ImportField): string {
  const v = (row[field.key] ?? "").toString().trim();
  if (!v && field.required) throw new Error(`"${field.label}" is required`);
  return v;
}

function parseNumber(label: string, v: string, fallback?: number): number {
  if (!v && fallback !== undefined) return fallback;
  const n = Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n)) throw new Error(`"${label}" must be a number, got "${v}"`);
  return n;
}

function parseDate(label: string, v: string): Date {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`"${label}" must be a date, got "${v}"`);
  return d;
}

/** Common Indian-register shorthand for attendance status. */
function normalizeAttendanceStatus(raw: string): AttendanceStatus {
  const v = raw.trim().toLowerCase();
  if (["p", "present", "pr"].includes(v)) return "present";
  if (["a", "absent", "ab"].includes(v)) return "absent";
  if (["hd", "half day", "half_day", "h"].includes(v)) return "half_day";
  if ((ATTENDANCE_STATUSES as readonly string[]).includes(v)) return v as AttendanceStatus;
  throw new Error(`Unrecognised attendance status "${raw}" (use present/absent/half_day, or P/A/HD)`);
}

function normalizeShift(raw: string): string {
  const v = raw.trim().toLowerCase();
  const match = SHIFTS.find(
    (s) => s.toLowerCase() === v || s.toLowerCase().startsWith(v) || v.includes(s.split(" ")[0].toLowerCase()),
  );
  if (match) return match;
  if (["a", "morning", "day"].includes(v)) return SHIFTS[0];
  if (["b", "evening"].includes(v)) return SHIFTS[1];
  if (["c", "night"].includes(v)) return SHIFTS[2];
  throw new Error(`Unrecognised shift "${raw}" (use one of: ${SHIFTS.join(", ")})`);
}

async function findOrCreateSupplier(tx: PrismaClient, name: string) {
  const existing = await tx.supplier.findFirst({ where: { name: { equals: name } } });
  if (existing) return existing;
  return tx.supplier.create({ data: { name, contact: "Unknown (imported)" } });
}

async function findOrCreateBuyer(tx: PrismaClient, name: string) {
  const existing = await tx.buyer.findFirst({ where: { name: { equals: name } } });
  if (existing) return existing;
  return tx.buyer.create({ data: { name, contact: "Unknown (imported)" } });
}

async function findOrCreateYarnType(
  tx: PrismaClient,
  opts: { name: string; count: string; material: string; colour: string; costPerKg?: number; lowStockThresholdKg?: number },
) {
  const existing = await tx.yarnType.findFirst({
    where: { name: opts.name, colour: opts.colour },
  });
  if (existing) return existing;
  return tx.yarnType.create({
    data: {
      name: opts.name,
      count: opts.count || "unknown",
      material: opts.material || "unknown",
      colour: opts.colour,
      costPerKg: opts.costPerKg ?? 0,
      lowStockThresholdKg: opts.lowStockThresholdKg ?? 50,
    },
  });
}

async function findOrCreateWorker(tx: PrismaClient, name: string, dailyWage?: number, role?: string) {
  const existing = await tx.worker.findFirst({ where: { name } });
  if (existing) return existing;
  const resolvedRole = (WORKER_ROLES as readonly string[]).includes((role ?? "").toLowerCase())
    ? (role as string).toLowerCase()
    : "helper";
  return tx.worker.create({
    data: { name, dailyWage: dailyWage ?? 0, role: resolvedRole },
  });
}

export const IMPORT_TARGETS: ImportTarget[] = [
  {
    key: "yarn_intake",
    label: "Yarn intake (stock register)",
    description: "One row per lot received: supplier, yarn, lot number, quantity.",
    fields: [
      { key: "supplierName", label: "Supplier name", required: true, example: "Shree Yarns Pvt Ltd" },
      { key: "yarnTypeName", label: "Yarn name", required: true, example: "Cotton 30s" },
      { key: "count", label: "Count", required: false, example: "30s" },
      { key: "material", label: "Material", required: false, example: "Cotton" },
      { key: "colour", label: "Colour", required: true, example: "Natural" },
      { key: "lotNo", label: "Lot number", required: true, example: "LOT-A101" },
      { key: "qtyReceivedKg", label: "Quantity received (kg)", required: true, example: "250" },
      { key: "receivedAt", label: "Date received", required: true, example: "2026-10-01" },
      { key: "costPerKg", label: "Cost per kg (₹, new yarn only)", required: false, example: "280" },
    ],
    async commitRow(row, userId) {
      const supplierName = need(row, { key: "supplierName", label: "Supplier name", required: true, example: "" });
      const yarnTypeName = need(row, { key: "yarnTypeName", label: "Yarn name", required: true, example: "" });
      const colour = need(row, { key: "colour", label: "Colour", required: true, example: "" });
      const lotNo = need(row, { key: "lotNo", label: "Lot number", required: true, example: "" });
      const qty = parseNumber("Quantity received (kg)", need(row, { key: "qtyReceivedKg", label: "Quantity received (kg)", required: true, example: "" }));
      if (qty <= 0) throw new Error("Quantity received must be positive");
      const receivedAt = parseDate("Date received", need(row, { key: "receivedAt", label: "Date received", required: true, example: "" }));

      const supplier = await findOrCreateSupplier(db, supplierName);
      const yarnType = await findOrCreateYarnType(db, {
        name: yarnTypeName,
        count: row.count ?? "",
        material: row.material ?? "",
        colour,
        costPerKg: row.costPerKg ? parseNumber("Cost per kg", row.costPerKg) : undefined,
      });

      const lot = await db.yarnLot.create({
        data: {
          yarnTypeId: yarnType.id,
          supplierId: supplier.id,
          lotNo,
          qtyReceivedKg: qty,
          qtyRemainingKg: qty,
          receivedAt,
        },
      });
      await logAudit("YarnLot", lot.id, "import", null, lot, userId);
      await checkLowStockAndNotify(yarnType.id);
      return { ok: true, summary: `Lot ${lotNo}: ${qty}kg of ${yarnTypeName} (${colour}) from ${supplierName}` };
    },
  },
  {
    key: "attendance",
    label: "Attendance / wage register",
    description: "One row per worker per day: name, date, shift, present/absent/half-day.",
    fields: [
      { key: "workerName", label: "Worker name", required: true, example: "Ramesh Kumar" },
      { key: "date", label: "Date", required: true, example: "2026-10-01" },
      { key: "shift", label: "Shift", required: true, example: "Morning (Shift A) / A / Morning" },
      { key: "status", label: "Status", required: true, example: "present / P" },
      { key: "dailyWage", label: "Daily wage (₹, new worker only)", required: false, example: "450" },
      { key: "role", label: "Role (new worker only)", required: false, example: "weaver" },
    ],
    async commitRow(row, userId) {
      const workerName = need(row, { key: "workerName", label: "Worker name", required: true, example: "" });
      const date = istMidnight(parseDate("Date", need(row, { key: "date", label: "Date", required: true, example: "" })));
      const shift = normalizeShift(need(row, { key: "shift", label: "Shift", required: true, example: "" }));
      const status = normalizeAttendanceStatus(need(row, { key: "status", label: "Status", required: true, example: "" }));

      const worker = await findOrCreateWorker(
        db,
        workerName,
        row.dailyWage ? parseNumber("Daily wage", row.dailyWage) : undefined,
        row.role,
      );

      const { start, end } = dayRange(istDateKey(date));
      const existing = await db.attendance.findFirst({ where: { workerId: worker.id, shift, date: { gte: start, lt: end } } });
      if (existing) {
        const updated = await db.attendance.update({ where: { id: existing.id }, data: { status } });
        await logAudit("Attendance", existing.id, "import-update", existing, updated, userId);
        return { ok: true, summary: `${workerName} on ${istDateKey(date)} (${shift}): updated to ${status}` };
      }
      const created = await db.attendance.create({ data: { workerId: worker.id, date, shift, status } });
      await logAudit("Attendance", created.id, "import", null, created, userId);
      return { ok: true, summary: `${workerName} on ${istDateKey(date)} (${shift}): marked ${status}` };
    },
  },
  {
    key: "expense",
    label: "Expense / bill slip",
    description: "One row per bill: category, amount, date.",
    fields: [
      { key: "category", label: "Category", required: true, example: "yarn / wages / power / overhead / other" },
      { key: "amount", label: "Amount (₹)", required: true, example: "12500" },
      { key: "date", label: "Date", required: true, example: "2026-10-01" },
      { key: "note", label: "Note", required: false, example: "Diesel for generator" },
      { key: "orderNo", label: "Linked order no. (optional)", required: false, example: "EVR-2610-004" },
    ],
    async commitRow(row, userId) {
      const categoryRaw = need(row, { key: "category", label: "Category", required: true, example: "" }).toLowerCase();
      const category = (EXPENSE_CATEGORIES as readonly string[]).includes(categoryRaw) ? categoryRaw : "other";
      const amount = parseNumber("Amount", need(row, { key: "amount", label: "Amount", required: true, example: "" }));
      if (amount <= 0) throw new Error("Amount must be positive");
      const date = istMidnight(parseDate("Date", need(row, { key: "date", label: "Date", required: true, example: "" })));

      let orderId: string | null = null;
      if (row.orderNo?.trim()) {
        const order = await db.order.findUnique({ where: { orderNo: row.orderNo.trim() } });
        if (!order) throw new Error(`Order "${row.orderNo}" not found`);
        orderId = order.id;
      }

      const expense = await db.expense.create({
        data: { category, amount, date, orderId, note: row.note?.trim() || null },
      });
      await logAudit("Expense", expense.id, "import", null, expense, userId);
      return { ok: true, summary: `₹${amount} (${category}) on ${istDateKey(date)}` };
    },
  },
  {
    key: "order",
    label: "Order book",
    description: "One row per order: buyer, fabric, quantity, price, deadline.",
    fields: [
      { key: "buyerName", label: "Buyer name", required: true, example: "Rajesh Garments" },
      { key: "fabricType", label: "Fabric type", required: true, example: "Twill" },
      { key: "colour", label: "Colour", required: true, example: "Navy" },
      { key: "gsm", label: "GSM", required: true, example: "150" },
      { key: "qtyMetres", label: "Quantity (metres)", required: true, example: "1000" },
      { key: "pricePerMetre", label: "Price per metre (₹)", required: true, example: "110" },
      { key: "deadline", label: "Deadline", required: true, example: "2026-12-15" },
    ],
    async commitRow(row, userId) {
      const buyerName = need(row, { key: "buyerName", label: "Buyer name", required: true, example: "" });
      const fabricType = need(row, { key: "fabricType", label: "Fabric type", required: true, example: "" });
      const colour = need(row, { key: "colour", label: "Colour", required: true, example: "" });
      const gsm = Math.round(parseNumber("GSM", need(row, { key: "gsm", label: "GSM", required: true, example: "" })));
      const qtyMetres = parseNumber("Quantity (metres)", need(row, { key: "qtyMetres", label: "Quantity (metres)", required: true, example: "" }));
      const pricePerMetre = parseNumber("Price per metre", need(row, { key: "pricePerMetre", label: "Price per metre", required: true, example: "" }));
      const deadline = parseDate("Deadline", need(row, { key: "deadline", label: "Deadline", required: true, example: "" }));
      if (qtyMetres <= 0 || pricePerMetre <= 0) throw new Error("Quantity and price must be positive");

      const buyer = await findOrCreateBuyer(db, buyerName);
      const [orderNo, trackingToken] = await Promise.all([generateOrderNo(), Promise.resolve(generateTrackingToken())]);
      const order = await db.order.create({
        data: { orderNo, buyerId: buyer.id, fabricType, colour, gsm, qtyMetres, pricePerMetre, deadline, status: "NEW", trackingToken },
      });
      await logAudit("Order", order.id, "import", null, order, userId);
      emit(RealtimeEvents.OrderStatus, { orderId: order.id, status: order.status });
      return { ok: true, summary: `${orderNo} for ${buyerName}: ${qtyMetres}m ${fabricType}` };
    },
  },
];

export function getImportTarget(key: string): ImportTarget | undefined {
  return IMPORT_TARGETS.find((t) => t.key === key);
}
