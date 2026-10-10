// Client-safe helpers for showing notifications. No DB imports here.

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
