import { z } from "zod";

export const yarnTypeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  count: z.string().min(1, "Count is required"),
  material: z.string().min(1, "Material is required"),
  colour: z.string().min(1, "Colour is required"),
  lowStockThresholdKg: z.number().positive("Must be a positive number of kg"),
  costPerKg: z.number().positive("Must be a positive cost"),
});

export type YarnTypeInput = z.infer<typeof yarnTypeSchema>;

export const yarnLotSchema = z.object({
  yarnTypeId: z.string().min(1, "Yarn type is required"),
  supplierId: z.string().min(1, "Supplier is required"),
  lotNo: z.string().min(1, "Lot number is required"),
  qtyReceivedKg: z.number().positive("Quantity received must be positive (kg)"),
  receivedAt: z.coerce.date(),
  linkedOrderId: z.string().optional().nullable(),
});

export type YarnLotInput = z.infer<typeof yarnLotSchema>;

export const supplierSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact: z.string().min(1, "Contact is required"),
  gstin: z.string().optional().nullable(),
});

export type SupplierInput = z.infer<typeof supplierSchema>;
