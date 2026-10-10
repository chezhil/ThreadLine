import { fieldErrorResponse } from "./accounts/http";

// A record other rows depend on is never deleted. Routes count its
// dependents inside the write transaction and refuse with 409 and a reason the
// UI shows as-is.

type Count = [count: number, singular: string, plural?: string];

/** "3 orders and 1 dispatch" — zero counts left out; "" when nothing depends. */
export function describeCounts(counts: Count[]): string {
  const parts = counts
    .filter(([n]) => n > 0)
    .map(([n, singular, plural]) => `${n} ${n === 1 ? singular : (plural ?? `${singular}s`)}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function inUse(message: string) {
  return fieldErrorResponse({ _form: [message] }, 409);
}
