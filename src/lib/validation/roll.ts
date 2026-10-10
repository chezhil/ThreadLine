import { z } from "zod";

export const DEFECT_TYPES = [
  { id: "hole", label: "Hole" },
  { id: "colour_mismatch", label: "Colour Mismatch" },
  { id: "uneven_weave", label: "Uneven Weave" },
] as const;

const DEFECT_IDS = DEFECT_TYPES.map((d) => d.id) as [string, ...string[]];

export const createRollSchema = z.object({
  orderId: z.string().min(1, "Order is required"),
  workOrderId: z.string().min(1, "Work Order is required"),
  machineId: z.string().min(1, "Machine is required"),
  shift: z.string().trim().min(1, "Shift is required").max(40, "Shift is too long"),
  yarnLotId: z.string().min(1, "Yarn Lot is required"),
  lengthMetres: z.coerce.number().finite().positive("Length must be a positive number").max(10_000, "A roll longer than 10,000 m looks wrong"),
  weightKg: z.coerce.number().finite().positive("Weight must be a positive number").max(5_000, "A roll heavier than 5,000 kg looks wrong"),
  // A new roll is always PENDING: only a QC inspection decides PASS/REWORK/
  // REJECT (any qcStatus a client still sends is ignored).
});

export type CreateRollInput = z.infer<typeof createRollSchema>;

/** Correcting a roll's measurements, shift or yarn lot (its order, work order
 * and loom are its identity — mint a new roll for those). */
export const updateRollSchema = createRollSchema
  .pick({ shift: true, yarnLotId: true, lengthMetres: true, weightKg: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update" });

export const qcInspectionSchema = z
  .object({
    result: z.enum(["PASS", "REWORK", "REJECT"], {
      message: "Result must be PASS, REWORK, or REJECT",
    }),
    defects: z
      .array(z.enum(DEFECT_IDS, { message: "Unknown defect type" }))
      .default([])
      .transform((list) => Array.from(new Set(list))),
    notes: z.string().max(500, "Keep notes under 500 characters").optional().nullable(),
    // Ignored by the API (the signed-in user is the inspector); kept optional
    // so queued offline submissions that still carry it remain valid.
    inspectorId: z.string().optional(),
    clientMutationId: z.string().max(100).optional(), // For idempotent offline queue sync
    // When an offline-queued inspection was actually made (set by the queue).
    clientRecordedAt: z.string().datetime({ offset: true }).optional(),
    // The roll's qcStatus as last seen by this client before the mutation was
    // queued offline. Lets the server tell "replaying my own queued write"
    // (fine) apart from "someone else inspected this roll differently while
    // I was offline" (a genuine conflict — see HARDENING_ADDENDUM.md item 5).
    baseQcStatus: z.enum(["PENDING", "PASS", "REWORK", "REJECT"]).optional(),
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

/** Reversing a wrong inspection; the roll goes back to its previous grade. */
export const qcReversalSchema = z.object({
  reason: z.string().trim().min(3, "Say why the inspection is being reversed").max(300, "Keep the reason under 300 characters"),
});
