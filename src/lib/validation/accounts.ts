import { z } from "zod";
import { istDateKey, MONTH_PATTERN } from "../accounts/period";

// Module 4 (Accounts/HR) schemas — imported by both the API routes and the
// client forms, never redefined.

export const WORKER_ROLES = [
  "spinner",
  "weaver",
  "dyer",
  "helper",
  "fitter",
  "qc_checker",
  "storekeeper",
  "supervisor",
] as const;

export const ATTENDANCE_STATUSES = ["present", "half_day", "absent"] as const;
export const SHIFTS = ["Morning (Shift A)", "Evening (Shift B)", "Night (Shift C)"] as const;
export const EXPENSE_CATEGORIES = ["yarn", "wages", "power", "overhead", "other"] as const;
export const PAYMENT_MODES = ["cash", "upi", "neft", "rtgs", "cheque"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Fraction of a day's wage earned for an attendance status. */
export const WAGE_FACTOR: Record<AttendanceStatus, number> = {
  present: 1,
  half_day: 0.5,
  absent: 0,
};

// A date-only field ("YYYY-MM-DD" from <input type="date">) that may not be in
// the future, judged in mill time (IST).
const pastOrTodayDate = (label: string) =>
  z.coerce
    .date({ error: `${label} is required` })
    .refine((d) => !Number.isNaN(d.getTime()), { message: `${label} is not a valid date` })
    .refine((d) => istDateKey(d) <= istDateKey(new Date()), {
      message: `${label} cannot be in the future`,
    });

const money = (label: string) =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .finite(`${label} must be a number`)
    .positive(`${label} must be greater than zero`)
    .max(100_000_000, `${label} looks too large`)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, {
      message: `${label} can have at most 2 decimal places`,
    });

const optionalId = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const workerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80, "Name is too long"),
  role: z.enum(WORKER_ROLES, { error: "Select a role" }),
  dailyWage: money("Daily wage").refine((n) => n <= 10_000, {
    message: "Daily wage above ₹10,000 looks wrong",
  }),
});
export type WorkerInput = z.infer<typeof workerSchema>;

export const workerUpdateSchema = workerSchema
  .partial()
  .extend({ archived: z.boolean({ error: "archived must be true or false" }).optional() })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one field to update",
  });

export const attendanceEntrySchema = z
  .object({
    workerId: z.string().trim().min(1, "Worker is required"),
    status: z.enum(ATTENDANCE_STATUSES, { error: "Select present, half day or absent" }),
    machineId: optionalId,
  })
  .refine((e) => !(e.status === "absent" && e.machineId), {
    message: "An absent worker cannot be assigned to a machine",
    path: ["machineId"],
  });

// One muster sheet: a date + shift and one line per worker. Saving the same
// worker/date/shift again updates that mark instead of duplicating it.
export const attendanceBatchSchema = z
  .object({
    date: pastOrTodayDate("Date"),
    shift: z.enum(SHIFTS, { error: "Select a shift" }),
    entries: z.array(attendanceEntrySchema).min(1, "Mark at least one worker"),
  })
  .refine((b) => new Set(b.entries.map((e) => e.workerId)).size === b.entries.length, {
    message: "A worker appears twice on this sheet",
    path: ["entries"],
  });
export type AttendanceBatchInput = z.infer<typeof attendanceBatchSchema>;

export const expenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES, { error: "Select a category" }),
  amount: money("Amount"),
  date: pastOrTodayDate("Date"),
  orderId: optionalId,
  note: z
    .string()
    .trim()
    .max(200, "Keep the note under 200 characters")
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});
export type ExpenseInput = z.infer<typeof expenseSchema>;

export const paymentSchema = z.object({
  invoiceId: z.string().trim().min(1, "Invoice is required"),
  amount: money("Amount"),
  mode: z.enum(PAYMENT_MODES, { error: "Select a payment mode" }),
  receivedAt: pastOrTodayDate("Received date"),
  // Lets a client dedupe a double-click or a retried submission — same
  // pattern as Roll QC and Dispatch, which already take one.
  clientMutationId: z.string().min(1).max(100).optional(),
});
export type PaymentInput = z.infer<typeof paymentSchema>;

// Reverse-and-correct (see the Reversal model): the reason is kept with the
// reversal; an optional correction is recorded as a new row in the same
// transaction.
const reversalReason = z
  .string({ error: "Say why this is being reversed" })
  .trim()
  .min(3, "Say why this is being reversed")
  .max(300, "Keep the reason under 300 characters");

export const paymentReversalSchema = z.object({
  reason: reversalReason,
  correction: paymentSchema.pick({ amount: true, mode: true, receivedAt: true }).optional(),
});
export type PaymentReversalInput = z.infer<typeof paymentReversalSchema>;

export const expenseReversalSchema = z.object({
  reason: reversalReason,
  correction: expenseSchema.optional(),
});
export type ExpenseReversalInput = z.infer<typeof expenseReversalSchema>;

export const invoiceReversalSchema = z.object({
  reason: reversalReason,
  // Re-issue at this price per metre (a credit note plus a corrected invoice);
  // omit to cancel the invoice outright.
  correction: z.object({ pricePerMetre: money("Price per metre").refine((n) => n <= 100_000, { message: "Price per metre looks too large" }) }).optional(),
});
export type InvoiceReversalInput = z.infer<typeof invoiceReversalSchema>;

export const monthQuerySchema = z
  .string()
  .regex(MONTH_PATTERN, "Month must be in YYYY-MM format")
  .optional();

export const alertsUpdateSchema = z
  .object({
    ids: z.array(z.string().min(1)).max(500).optional(),
    all: z.boolean().optional(),
    read: z.boolean().default(true),
  })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), {
    message: "Pass notification ids or all: true",
    path: ["ids"],
  });

export const assistantQuerySchema = z.object({
  question: z
    .string()
    .trim()
    .min(3, "Ask a question")
    .max(500, "Keep the question under 500 characters"),
});
