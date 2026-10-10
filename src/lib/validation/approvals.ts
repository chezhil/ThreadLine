import { z } from "zod";
import { MONTH_PATTERN } from "../accounts/period";

// HARDENING_ADDENDUM.md item 4 — the three small approval workflows.

export const purchaseRequestSchema = z.object({
  yarnTypeId: z.string().min(1, "Yarn type is required"),
  qtyKg: z.coerce.number().positive("Quantity must be a positive number"),
  note: z.string().trim().max(200).optional().nullable(),
});
export type PurchaseRequestInput = z.infer<typeof purchaseRequestSchema>;

export const maintenanceRequestSchema = z.object({
  machineId: z.string().min(1, "Machine is required"),
  description: z.string().trim().min(1, "Description is required").max(300),
});
export type MaintenanceRequestInput = z.infer<typeof maintenanceRequestSchema>;

export const payoutApprovalSchema = z.object({
  month: z.string().regex(MONTH_PATTERN, "Month must be in YYYY-MM format"),
});
export type PayoutApprovalInput = z.infer<typeof payoutApprovalSchema>;

export const approvalActionSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"], { message: "Status must be APPROVED or REJECTED" }),
  // Maintenance-only: the owner's repair cost estimate at approval time.
  cost: z.coerce.number().nonnegative().optional(),
});
export type ApprovalActionInput = z.infer<typeof approvalActionSchema>;
