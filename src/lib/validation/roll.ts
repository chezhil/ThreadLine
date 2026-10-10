import { z } from "zod";

export const DEFECT_TYPES = [
  { id: "hole", label: "Hole" },
  { id: "colour_mismatch", label: "Colour Mismatch" },
  { id: "uneven_weave", label: "Uneven Weave" },
] as const;

export const createRollSchema = z.object({
  orderId: z.string().min(1, "Order is required"),
  workOrderId: z.string().min(1, "Work Order is required"),
  machineId: z.string().min(1, "Machine is required"),
  shift: z.string().min(1, "Shift is required"),
  yarnLotId: z.string().min(1, "Yarn Lot is required"),
  lengthMetres: z.coerce.number().positive("Length must be a positive number"),
  weightKg: z.coerce.number().positive("Weight must be a positive number"),
  qcStatus: z.enum(["PENDING", "PASS", "REWORK", "REJECT"]).default("PENDING"),
});

export type CreateRollInput = z.infer<typeof createRollSchema>;

export const qcInspectionSchema = z
  .object({
    result: z.enum(["PASS", "REWORK", "REJECT"], {
      message: "Result must be PASS, REWORK, or REJECT",
    }),
    defects: z.array(z.string()).default([]),
    notes: z.string().optional().nullable(),
    // Ignored by the API (the signed-in user is the inspector); kept optional
    // so queued offline submissions that still carry it remain valid.
    inspectorId: z.string().optional(),
    clientMutationId: z.string().optional(), // For idempotent offline queue sync
  })
  .refine(
    (data) => {
      if ((data.result === "REWORK" || data.result === "REJECT") && (!data.defects || data.defects.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: "At least one defect must be selected for REWORK or REJECT",
      path: ["defects"],
    }
  );

export type QCInspectionInput = z.infer<typeof qcInspectionSchema>;
