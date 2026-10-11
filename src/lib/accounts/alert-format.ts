// Client-safe helpers for showing notifications. No DB imports here.
import type { Prisma } from "@prisma/client";
import type { Role } from "@/lib/auth";

export interface NotificationRow {
  id: string;
  type: string;
  message: string;
  severity: string;
  read: boolean;
  createdAt: string;
}

const KIND_LABELS: Record<string, string> = {
  low_stock: "Low stock",
  production_delay: "Delay risk",
  production_reorder: "Reorder",
  machine_breakdown: "Breakdown",
  order_ready: "Order ready",
  payment_received: "Payment",
};

/** "production_delay:abc" → "production_delay" */
export function alertKind(type: string): string {
  return type.split(":")[0];
}

export function alertKindLabel(type: string): string {
  const kind = alertKind(type);
  return KIND_LABELS[kind] ?? kind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Severity → the shared status-colour keys in tokens.ts (red/amber/grey). */
export function severityStatus(severity: string): string {
  if (severity === "critical") return "reject";
  if (severity === "warning") return "rework";
  return "pending";
}

export function formatAlertTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The WhatsApp-style text the owner would receive. Preview only — nothing is
 * sent anywhere; real delivery (WhatsApp Business API) is future work.
 */
export function whatsappPreviewText(n: NotificationRow): string {
  const icon = n.severity === "critical" ? "🔴" : n.severity === "warning" ? "🟠" : "🔵";
  return `${icon} *Everest Textile Mills — ${alertKindLabel(n.type)}*\n${n.message}\n_${formatAlertTime(n.createdAt)} · ThreadLine_`;
}

// ---------------------------------------------------------------- audience --

/** Which alerts each role is shown (the owner sees every alert). A role only
 * gets what it can act on — a QC inspector has no use for payment receipts —
 * so its bell counts real work, not the whole mill's feed. Shared by the
 * alerts API (server filter) and the live toasts (client filter). */
const ROLE_ALERT_KINDS: Record<Exclude<Role, "owner">, { kinds: string[]; decisions?: "purchase" | "maintenance" }> = {
  storekeeper: { kinds: ["low_stock", "production_reorder", "order_ready"], decisions: "purchase" },
  floor_supervisor: { kinds: ["production_delay", "machine_breakdown", "production_reorder"], decisions: "maintenance" },
  qc_inspector: { kinds: ["machine_breakdown", "order_ready"] },
};

// Approval decisions are typed `approval_decided:<purchase|maintenance>`;
// older rows are plain `approval_decided` and are told apart by their text.
const DECISION_TEXT = { purchase: "Purchase request", maintenance: "Maintenance request" } as const;

export function roleSeesAlert(role: Role, n: { type: string; message: string }): boolean {
  if (role === "owner") return true;
  const scope = ROLE_ALERT_KINDS[role];
  if (scope.kinds.includes(alertKind(n.type))) return true;
  const d = scope.decisions;
  return !!d && (n.type.startsWith(`approval_decided:${d}`) || (n.type === "approval_decided" && n.message.startsWith(DECISION_TEXT[d])));
}

/** The same rule as a Prisma filter; `{}` (no restriction) for the owner. */
export function alertScopeForRole(role: Role): Prisma.NotificationWhereInput {
  if (role === "owner") return {};
  const scope = ROLE_ALERT_KINDS[role];
  const d = scope.decisions;
  return {
    OR: [
      ...scope.kinds.flatMap((k) => [{ type: k }, { type: { startsWith: `${k}:` } }]),
      ...(d
        ? [{ type: { startsWith: `approval_decided:${d}` } }, { type: "approval_decided", message: { startsWith: DECISION_TEXT[d] } }]
        : []),
    ],
  };
}
