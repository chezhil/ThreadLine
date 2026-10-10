// Shared design tokens. Consume these everywhere — never hardcode a hex colour,
// spacing value or radius in a feature file. Mirrored as CSS vars in globals.css.

export const statusColor = {
  running: "green",
  pass: "green",
  idle: "amber",
  rework: "amber",
  breakdown: "red",
  reject: "red",
  maintenance: "red",
  pending: "grey",
  // Order-level granular statuses (src/lib/order-status.ts)
  not_started: "grey",
  in_production: "amber",
  done: "green",
  needs_rework: "amber",
  not_dispatched: "grey",
  partially_dispatched: "amber",
  fully_dispatched: "green",
  unpaid: "red",
  partial: "amber",
  paid: "green",
  // AlertDelivery outbox statuses (src/lib/alerts/outbox.ts)
  sent: "green",
  retrying: "amber",
  failed: "red",
  // Approval workflow statuses (HARDENING_ADDENDUM.md item 4)
  approved: "green",
  rejected: "red",
} as const;

export type StatusColorKey = keyof typeof statusColor;

export const colorClasses: Record<"green" | "amber" | "red" | "grey", string> = {
  green: "bg-green-100 text-green-800 border-green-300",
  amber: "bg-amber-100 text-amber-800 border-amber-300",
  red: "bg-red-100 text-red-800 border-red-300",
  grey: "bg-gray-100 text-gray-700 border-gray-300",
};

export function statusBadgeClass(key: string): string {
  const color = statusColor[key.toLowerCase() as StatusColorKey] ?? "grey";
  return colorClasses[color];
}

export const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
} as const;

export const radius = {
  sm: "0.25rem",
  md: "0.5rem",
  lg: "0.75rem",
  full: "9999px",
} as const;

export const fontSize = {
  xs: "0.75rem",
  sm: "0.875rem",
  base: "1rem",
  lg: "1.125rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
} as const;

export const ORDER_STATUSES = [
  "NEW",
  "CONFIRMED",
  "IN_PRODUCTION",
  "QC",
  "READY",
  "DISPATCHED",
  "CLOSED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isValidOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  const fromIdx = ORDER_STATUSES.indexOf(from);
  const toIdx = ORDER_STATUSES.indexOf(to);
  return toIdx === fromIdx + 1;
}
