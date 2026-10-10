/**
 * Safe Formatter & Data Sanitizer for Buyer WhatsApp Dispatch Alerts.
 * 
 * Security Rule: Under NO circumstances include machine numbers (e.g. Loom 4),
 * weaver names, internal yarn lot costs, or mill profit margins.
 */

export interface DispatchWhatsAppPayload {
  orderNo: string;
  buyerName: string;
  buyerPhone: string;
  fabricType: string;
  totalMetres: number;
  rollCount: number;
  truckNo: string;
  trackingToken: string;
  appUrl?: string;
}

/**
 * Deterministically formats an official buyer dispatch confirmation message.
 * Strict anti-leak rule: zero internal costing, wages, machine, or margin data.
 */
export function formatWhatsAppMessage(payload: DispatchWhatsAppPayload): string {
  const appUrl = (payload.appUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

  return [
    `🧵 *Everest Textile Mills — Dispatch Confirmation*`,
    `Dear *${payload.buyerName}*, your order is on the way!`,
    ``,
    `📦 *Order:* ${payload.orderNo}`,
    `📏 *Quantity:* ${payload.totalMetres} m (${payload.rollCount} Rolls)`,
    `🏷️ *Fabric:* ${payload.fabricType}`,
    `🚚 *Vehicle Registration:* ${payload.truckNo}`,
    ``,
    `📍 *Live Tracking & Digital Gate Pass:*`,
    `${appUrl}/track/${payload.trackingToken}`,
    ``,
    `_Automated dispatch notification from Everest Textile Mills._`,
  ].join("\n");
}

/**
 * Builds a direct wa.me link with clean phone digits and URL-encoded message text.
 */
export function getWhatsAppShareUrl(phone: string, text: string): string {
  const cleanPhone = phone.replace(/\D/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}
