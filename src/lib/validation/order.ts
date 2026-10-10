import { z } from "zod";
import { ORDER_STATUSES } from "../tokens";
import {
  AT_LEAST_ONE_FIELD,
  archivedFlag,
  atLeastOneField,
  optionalGstin,
  optionalText,
  positiveNumber,
  requiredText,
} from "./common";

// A date-only deadline ("2026-11-30", from a date input) means the end of
// that day at the mill (IST), not 05:30 IST — which is what UTC midnight is.
const deadlineDate = z.preprocess(
  (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59+05:30` : v),
  z.coerce.date({ error: "Deadline is required" }).refine((d) => !Number.isNaN(d.getTime()), { message: "Deadline is not a valid date" }),
);
const futureDeadline = deadlineDate.refine((d) => d.getTime() > Date.now(), {
  message: "Deadline cannot be in the past",
});

const gsm = z.coerce
  .number({ error: "GSM must be a number" })
  .int("GSM must be a whole number")
  .min(20, "GSM must be at least 20")
  .max(2000, "GSM above 2000 looks wrong");

// The fields a person types for an order — shared by create and edit.
const orderFields = {
  buyerId: z.string().trim().min(1, "Buyer is required"),
  fabricType: requiredText("Fabric type", 60),
  colour: requiredText("Colour", 60),
  gsm,
  qtyMetres: positiveNumber("Quantity (metres)", 10_000_000),
  pricePerMetre: positiveNumber("Price per metre", 100_000),
  deadline: futureDeadline,
};

// Optional: when given, the feasibility check is re-run on save and its
// result stored on the order (Order.feasibilityResult).
const feasibilityInputs = {
  yarnTypeId: z.string().trim().min(1).optional(),
  wastagePct: z.coerce.number().min(0).max(100).optional(),
};

export const orderCreateSchema = z.object({ ...orderFields, ...feasibilityInputs });

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

/** Editing an order's details (only while it is NEW or CONFIRMED). */
export const orderUpdateSchema = z
  .object({ ...orderFields, ...feasibilityInputs })
  .partial()
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);

export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export const orderStatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export const feasibilityRequestSchema = z.object({
  fabricType: requiredText("Fabric type", 60),
  gsm,
  qtyMetres: positiveNumber("Quantity (metres)", 10_000_000),
  deadline: deadlineDate,
  wastagePct: z.coerce.number().min(0).max(100).default(8),
  yarnTypeId: z.string().min(1, "Yarn type is required for the feasibility check"),
});

export type FeasibilityRequestInput = z.infer<typeof feasibilityRequestSchema>;

export const buyerSchema = z.object({
  name: requiredText("Name", 120),
  contact: requiredText("Contact", 120),
  gstin: optionalGstin,
  address: optionalText("Address", 300),
});

export type BuyerInput = z.infer<typeof buyerSchema>;

export const buyerUpdateSchema = buyerSchema
  .partial()
  .extend({ archived: archivedFlag })
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
