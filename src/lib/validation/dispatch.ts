import { z } from "zod";

const truckNo = z
  .string()
  .trim()
  .min(1, "Truck number is required")
  .max(32, "Truck number is too long (at most 32 characters)")
  .regex(/^[A-Z0-9 -]+$/i, "Invalid truck number format");

export const createDispatchSchema = z.object({
  buyerId: z.string().min(1, "Buyer is required"),
  truckNo,
  rollIds: z
    .array(z.string())
    .min(1, "At least one roll must be selected for dispatch")
    .max(500, "Load at most 500 rolls on one truck")
    .refine((ids) => new Set(ids).size === ids.length, { message: "A roll is listed twice" }),
  clientMutationId: z.string().max(100).optional(), // For idempotent offline queue sync
});

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;

/** Correcting a mistyped truck number; what was loaded can't change. */
export const updateDispatchSchema = z.object({ truckNo });
