import { z } from "zod";

export const createDispatchSchema = z.object({
  buyerId: z.string().min(1, "Buyer is required"),
  truckNo: z
    .string()
    .min(1, "Truck number is required")
    .regex(/^[A-Z0-9 -]+$/i, "Invalid truck number format"),
  rollIds: z.array(z.string()).min(1, "At least one roll must be selected for dispatch"),
  clientMutationId: z.string().optional(), // For idempotent offline queue sync
});

export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;
