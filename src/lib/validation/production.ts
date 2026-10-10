import { z } from "zod";

export const machineTypeSchema = z.enum(["spinning", "loom", "dyeing"]);
export const machineStatusSchema = z.enum(["RUNNING", "IDLE", "BREAKDOWN", "MAINTENANCE"]);
export const stageSchema = z.enum(["spinning", "weaving", "dyeing"]);
export const productionIdSchema = z.string().uuid("Invalid identifier");

export const machineSchema = z.object({
  name: z.string().trim().min(2, "Enter a machine name").max(80),
  type: machineTypeSchema,
  status: machineStatusSchema.default("IDLE"),
  capacityMetresPerShift: z.coerce.number().finite().positive("Capacity must be greater than zero"),
});

export const machineStatusChangeSchema = z.object({ status: machineStatusSchema });

export const machineEditSchema = machineSchema.omit({ status: true }).partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Provide a field to update" },
);

export const workOrderSchema = z.object({
  orderId: z.string().uuid("Select an order"),
  stage: stageSchema,
  machineId: z.string().uuid("Select a machine"),
  plannedQty: z.coerce.number().finite().positive("Planned metres must be greater than zero"),
});

export const workOrderUpdateSchema = workOrderSchema
  .pick({ machineId: true, plannedQty: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Provide a field to update" });

export const productionLogSchema = z.object({
  workOrderId: z.string().uuid("Select a work order"),
  shift: z.string().trim().min(1, "Enter a shift").max(40),
  qtyProduced: z.coerce.number().finite().positive("Produced metres must be greater than zero"),
});

export const productionLogUpdateSchema = productionLogSchema
  .pick({ shift: true, qtyProduced: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Provide a field to update" });

export type MachineInput = z.infer<typeof machineSchema>;
export type WorkOrderInput = z.infer<typeof workOrderSchema>;
export type ProductionLogInput = z.infer<typeof productionLogSchema>;
