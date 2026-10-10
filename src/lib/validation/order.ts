import { z } from "zod";
import { ORDER_STATUSES } from "../tokens";

export const orderCreateSchema = z.object({
  buyerId: z.string().min(1, "Buyer is required"),
  fabricType: z.string().min(1, "Fabric type is required"),
  colour: z.string().min(1, "Colour is required"),
  gsm: z.number().int().positive("GSM must be a positive integer"),
  qtyMetres: z.number().positive("Quantity must be positive (metres)"),
  pricePerMetre: z.number().positive("Price per metre must be positive"),
  deadline: z.coerce.date().refine((d) => d.getTime() > Date.now(), {
    message: "Deadline cannot be in the past",
  }),
});

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderStatusUpdateSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export const feasibilityRequestSchema = z.object({
  fabricType: z.string().min(1),
  gsm: z.number().int().positive(),
  qtyMetres: z.number().positive(),
  deadline: z.coerce.date(),
  wastagePct: z.number().min(0).max(100).default(8),
  yarnTypeId: z.string().min(1, "Yarn type is required for the feasibility check"),
});

export type FeasibilityRequestInput = z.infer<typeof feasibilityRequestSchema>;

export const buyerSchema = z.object({
  name: z.string().min(1, "Name is required"),
  contact: z.string().min(1, "Contact is required"),
  gstin: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

export type BuyerInput = z.infer<typeof buyerSchema>;
