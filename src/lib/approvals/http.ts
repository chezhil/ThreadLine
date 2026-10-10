import { fieldErrorResponse } from "@/lib/accounts/http";

// Shared by the three approval workflows (purchase, maintenance, payout).
// A decision is a conditional PENDING → APPROVED/REJECTED update, so two
// owners (or one double-click) racing on the same request can't both act.

/** The answer when a request was already decided by someone else first. */
export function alreadyDecided(status: string) {
  return fieldErrorResponse({ status: [`Already ${status.toLowerCase()}`] }, 409);
}

export const approvalVerb = (status: "APPROVED" | "REJECTED") => (status === "APPROVED" ? "approved" : "rejected");
