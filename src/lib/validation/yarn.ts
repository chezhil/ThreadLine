import { z } from "zod";
import { istDateKey } from "../accounts/period";
import { AT_LEAST_ONE_FIELD, archivedFlag, atLeastOneField, optionalGstin, positiveNumber, requiredText } from "./common";

export const yarnTypeSchema = z.object({
  name: requiredText("Name", 80),
  count: requiredText("Count", 20),
  material: requiredText("Material", 60),
  colour: requiredText("Colour", 60),
  lowStockThresholdKg: positiveNumber("Low-stock threshold (kg)", 1_000_000),
  costPerKg: positiveNumber("Cost per kg", 100_000),
});

export type YarnTypeInput = z.infer<typeof yarnTypeSchema>;

export const yarnTypeUpdateSchema = yarnTypeSchema
  .partial()
  .extend({ archived: archivedFlag })
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);

// Received date: a date-only form value or an ISO instant. Goods can't
// arrive in the future (compared as mill dates, IST).
const receivedDate = z.coerce
  .date({ error: "Received date is required" })
  .refine((d) => !Number.isNaN(d.getTime()), { message: "Received date is not a valid date" })
  .refine((d) => istDateKey(d) <= istDateKey(new Date()), { message: "Received date can't be in the future" });

export const yarnLotSchema = z.object({
  yarnTypeId: z.string().trim().min(1, "Yarn type is required"),
  supplierId: z.string().trim().min(1, "Supplier is required"),
  lotNo: requiredText("Lot number", 40),
  qtyReceivedKg: positiveNumber("Quantity received (kg)", 1_000_000),
  receivedAt: receivedDate,
  linkedOrderId: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null)),
});

export type YarnLotInput = z.infer<typeof yarnLotSchema>;

export const yarnLotUpdateSchema = yarnLotSchema.partial().refine(atLeastOneField, AT_LEAST_ONE_FIELD);

export const supplierSchema = z.object({
  name: requiredText("Name", 120),
  contact: requiredText("Contact", 120),
  gstin: optionalGstin,
});

export type SupplierInput = z.infer<typeof supplierSchema>;

export const supplierUpdateSchema = supplierSchema
  .partial()
  .extend({ archived: archivedFlag })
  .refine(atLeastOneField, AT_LEAST_ONE_FIELD);
