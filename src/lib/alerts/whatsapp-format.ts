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
  /** Every order on the truck, when a dispatch carries more than one. */
  tracking?: { orderNo: string; trackingToken: string }[];
  appUrl?: string;
}

/**
 * wa.me needs the number in full international form, digits only. Mill
 * contacts are usually stored as "+91 98765 11111", sometimes as a bare
 * 10-digit Indian mobile or with a leading 0. Returns null when the value
 * can't be a phone number, so callers refuse instead of messaging nobody.
 */
export function normalizeWhatsAppPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/**
 * Deterministically formats an official buyer dispatch confirmation message.
 * Strict anti-leak rule: zero internal costing, wages, machine, or margin data.
 */
export function formatWhatsAppMessage(payload: DispatchWhatsAppPayload): string {
  const appUrl = (payload.appUrl || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

  const tracking = payload.tracking && payload.tracking.length > 1 ? payload.tracking : null;
  const trackingLines = tracking
    ? tracking.map((t) => `${t.orderNo}: ${appUrl}/track/${t.trackingToken}`)
    : [`${appUrl}/track/${payload.trackingToken}`];

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
    ...trackingLines,
    ``,
    `_Automated dispatch notification from Everest Textile Mills._`,
  ].join("\n");
}

/**
 * Builds a direct wa.me link with clean phone digits and URL-encoded message text.
 */
export function getWhatsAppShareUrl(phone: string, text: string): string {
  const cleanPhone = normalizeWhatsAppPhone(phone) ?? phone.replace(/\D/g, "");
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}
