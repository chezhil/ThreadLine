import { normalizeWhatsAppPhone } from "./whatsapp-format";

// WhatsApp Cloud API (Meta) client for the delivery outbox. Enabled only when
// WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set; otherwise the
// outbox keeps its simulated send, so a mill without a Business account still
// works. WHATSAPP_GRAPH_BASE_URL exists so tests can use a stand-in server.
//
// Meta only lets a business start a conversation with an approved *template*;
// free text is delivered only inside the 24h window after the customer last
// wrote. This sends plain text — if buyers haven't messaged the mill's number,
// Meta rejects it (error 131047) and the row ends FAILED with that reason,
// which is the cue to register templates and switch to type "template".

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
const TIMEOUT_MS = Number(process.env.WHATSAPP_TIMEOUT_MS ?? 15_000);

export function whatsappConfigured(): boolean {
  return !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;
}

function graphBase(): string {
  return (process.env.WHATSAPP_GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/$/, "");
}

export type CloudSendResult =
  | { ok: true; messageId: string }
  // permanent = retrying the same request can't succeed (bad number, auth, 4xx)
  | { ok: false; error: string; permanent: boolean };

/** Buyer-facing text for each queued template. Internal figures never appear. */
export function messageForAlert(templateName: string | null, payload: Record<string, unknown>): string | null {
  if (typeof payload.message === "string" && payload.message) return payload.message;
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const link = typeof payload.trackingPath === "string" && base ? `\n\nTrack it live: ${base}${payload.trackingPath}` : "";
  const dear = payload.buyerName ? `Dear ${payload.buyerName}, ` : "";
  switch (templateName) {
    case "order_ready":
      return `Everest Textile Mills: ${dear}your order ${payload.orderNo} has passed quality checks and is ready for dispatch.${link}`;
    case "order_dispatched":
      return `Everest Textile Mills: ${dear}your order ${payload.orderNo} is on its way${payload.truckNo ? ` on vehicle ${payload.truckNo}` : ""}.${link}`;
    default:
      return null;
  }
}

export async function sendWhatsAppText(recipient: string, body: string): Promise<CloudSendResult> {
  const to = normalizeWhatsAppPhone(recipient);
  if (!to) return { ok: false, permanent: true, error: `"${recipient}" is not a usable phone number` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${graphBase()}/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: true, body } }),
      signal: controller.signal,
    });
  } catch (e) {
    const why = controller.signal.aborted ? `timed out after ${TIMEOUT_MS / 1000}s` : e instanceof Error ? e.message : "network error";
    return { ok: false, permanent: false, error: `WhatsApp API unreachable: ${why}` };
  } finally {
    clearTimeout(timer);
  }

  const json = (await res.json().catch(() => null)) as {
    messages?: { id?: string }[];
    error?: { message?: string; code?: number };
  } | null;

  const id = json?.messages?.[0]?.id;
  if (res.ok && id) return { ok: true, messageId: id };

  const detail = json?.error?.message ?? `HTTP ${res.status}`;
  const code = json?.error?.code ? ` (code ${json.error.code})` : "";
  // 429 and 5xx are worth retrying; everything else (bad token, bad number,
  // outside the 24h window) will fail the same way every time.
  const transient = res.status === 429 || res.status >= 500;
  return { ok: false, permanent: !transient, error: `WhatsApp API: ${detail}${code}` };
}
