import { normalizeWhatsAppPhone } from "./whatsapp-format";

// WhatsApp Cloud API (Meta) client for the delivery outbox. Enabled only when
// WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set; otherwise the
// outbox keeps its simulated send, so a mill without a Business account still
// works. WHATSAPP_GRAPH_BASE_URL exists so tests can use a stand-in server.
//
// Meta only lets a business start a conversation with an approved *template*;
// free text is delivered only inside the 24h window after the customer last
// wrote. So each alert uses its approved template when one is configured
// (WHATSAPP_TEMPLATE_ORDER_READY / WHATSAPP_TEMPLATE_ORDER_DISPATCHED, language
// WHATSAPP_TEMPLATE_LANG) and falls back to plain text otherwise. Without a
// template, a buyer who hasn't messaged the mill's number gets Meta error
// 131047 and the row ends FAILED with that reason.

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

/**
 * Body parameters for each template, in the order of the {{1}}, {{2}}… slots
 * the template was registered with (see README). Meta rejects empty
 * parameters and parameters containing newlines/tabs, so values are cleaned
 * and missing ones become "-".
 */
export function templateParams(templateName: string | null, payload: Record<string, unknown>): string[] | null {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const link = typeof payload.trackingPath === "string" && base ? `${base}${payload.trackingPath}` : "";
  const clean = (v: unknown) => (String(v ?? "").replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 500) || "-");
  switch (templateName) {
    case "order_ready":
      return [clean(payload.buyerName), clean(payload.orderNo), clean(link)];
    case "order_dispatched":
      return [clean(payload.buyerName), clean(payload.orderNo), clean(payload.truckNo), clean(link)];
    default:
      return null;
  }
}

/** The approved Meta template registered for this alert, if one is configured. */
export function configuredTemplate(templateName: string | null): string | null {
  const name = templateName === "order_ready" ? process.env.WHATSAPP_TEMPLATE_ORDER_READY : templateName === "order_dispatched" ? process.env.WHATSAPP_TEMPLATE_ORDER_DISPATCHED : undefined;
  return name?.trim() || null;
}

export type CloudMessage =
  | { type: "text"; body: string }
  | { type: "template"; name: string; params: string[] };

export async function sendWhatsAppText(recipient: string, body: string): Promise<CloudSendResult> {
  return sendWhatsApp(recipient, { type: "text", body });
}

export async function sendWhatsApp(recipient: string, message: CloudMessage): Promise<CloudSendResult> {
  const to = normalizeWhatsAppPhone(recipient);
  if (!to) return { ok: false, permanent: true, error: `"${recipient}" is not a usable phone number` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${graphBase()}/${GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        ...(message.type === "text"
          ? { type: "text", text: { preview_url: true, body: message.body } }
          : {
              type: "template",
              template: {
                name: message.name,
                language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
                components: [{ type: "body", parameters: message.params.map((text) => ({ type: "text", text })) }],
              },
            }),
      }),
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
