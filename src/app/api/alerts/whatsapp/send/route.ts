import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { qualityActor } from "@/lib/quality/auth";
import { writeTransaction } from "@/lib/concurrency";
import { logAudit } from "@/lib/audit";
import {
  formatWhatsAppMessage,
  getWhatsAppShareUrl,
  normalizeWhatsAppPhone,
  type DispatchWhatsAppPayload,
} from "@/lib/alerts/whatsapp-format";

export const instant = false;

const TEMPLATE = "dispatch_whatsapp_manual";
const RATE_LIMIT = 3;

// The client only says WHICH dispatch/order to message. Buyer, phone, quantity,
// truck and tracking links all come from the database: a signed-in user must
// not be able to make the mill send an arbitrary text or link to an arbitrary
// number under the mill's name.
const schema = z
  .object({
    dispatchId: z.string().trim().min(1).optional(),
    orderId: z.string().trim().min(1).optional(),
    /** Just return what would be sent (for the preview modal); records nothing. */
    preview: z.boolean().optional(),
  })
  .refine((v) => !!v.dispatchId !== !!v.orderId, { message: "Send exactly one of dispatchId or orderId" });

const round1 = (n: number) => Math.round(n * 10) / 10;

function appUrlFor(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : req.nextUrl.origin;
}

async function payloadForDispatch(dispatchId: string): Promise<DispatchWhatsAppPayload | null> {
  const d = await db.dispatch.findUnique({
    where: { id: dispatchId },
    include: { buyer: true, rolls: { include: { order: true } } },
  });
  if (!d || !d.rolls.length) return null;
  const orders = new Map<string, (typeof d.rolls)[number]["order"]>();
  for (const r of d.rolls) orders.set(r.order.id, r.order);
  const list = [...orders.values()];
  const first = list[0];
  return {
    orderNo: list.map((o) => o.orderNo).join(", "),
    buyerName: d.buyer.name,
    buyerPhone: d.buyer.contact,
    fabricType: [...new Set(list.map((o) => o.fabricType))].join(" / "),
    totalMetres: round1(d.rolls.reduce((s, r) => s + r.lengthMetres, 0)),
    rollCount: d.rolls.length,
    truckNo: d.truckNo,
    trackingToken: first.trackingToken,
    tracking: list.map((o) => ({ orderNo: o.orderNo, trackingToken: o.trackingToken })),
  };
}

async function payloadForOrder(orderId: string): Promise<DispatchWhatsAppPayload | null> {
  const o = await db.order.findUnique({
    where: { id: orderId },
    include: { buyer: true, rolls: { where: { dispatchId: { not: null } }, include: { dispatch: true } } },
  });
  if (!o) return null;
  const dispatched = o.rolls;
  // Latest truck that carried this order's rolls; an order that hasn't shipped
  // has no truck, so there is nothing to tell the buyer yet.
  if (!dispatched.length) return null;
  const latest = dispatched
    .map((r) => r.dispatch)
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.dispatchedAt.getTime() - a.dispatchedAt.getTime())[0];
  if (!latest) return null;
  const onLatest = dispatched.filter((r) => r.dispatchId === latest.id);
  return {
    orderNo: o.orderNo,
    buyerName: o.buyer.name,
    buyerPhone: o.buyer.contact,
    fabricType: o.fabricType,
    totalMetres: round1(onLatest.reduce((s, r) => s + r.lengthMetres, 0)),
    rollCount: onLatest.length,
    truckNo: latest.truckNo,
    trackingToken: o.trackingToken,
  };
}

export async function POST(req: NextRequest) {
  const actor = await qualityActor("owner", "storekeeper");
  if ("response" in actor) return actor.response;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  const payload = parsed.data.dispatchId
    ? await payloadForDispatch(parsed.data.dispatchId)
    : await payloadForOrder(parsed.data.orderId!);
  if (!payload) {
    return NextResponse.json(
      { error: "Nothing has shipped for that dispatch/order yet, so there is no dispatch message to send." },
      { status: 404 },
    );
  }

  if (parsed.data.preview) {
    return NextResponse.json({ preview: true, payload, target: parsed.data.dispatchId ? { dispatchId: parsed.data.dispatchId } : { orderId: parsed.data.orderId } });
  }

  const phone = normalizeWhatsAppPhone(payload.buyerPhone);
  if (!phone) {
    return NextResponse.json(
      { error: `${payload.buyerName}'s contact "${payload.buyerPhone}" isn't a usable phone number. Fix it on the buyer record first.` },
      { status: 422 },
    );
  }

  // Sanitized message — zero internal costs, wages, machines, or margins.
  const message = formatWhatsAppMessage({ ...payload, appUrl: appUrlFor(req) });
  const shareUrl = getWhatsAppShareUrl(phone, message);

  // Rate limit: max 3 manual WhatsApp messages per hour per number. The count
  // and the insert share one write transaction, so two simultaneous clicks
  // can't both squeeze under the limit. Only these manual sends count; the
  // automatic dispatch alerts use a different template and must not eat the
  // budget.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const result = await writeTransaction(async (tx) => {
    const recent = await tx.alertDelivery.count({
      where: { channel: "WHATSAPP", templateName: TEMPLATE, recipient: phone, createdAt: { gte: oneHourAgo } },
    });
    if (recent >= RATE_LIMIT) return null;
    return tx.alertDelivery.create({
      data: {
        channel: "WHATSAPP",
        recipient: phone,
        templateName: TEMPLATE,
        payload: JSON.stringify({ ...payload, appUrl: undefined, message }),
        // Click-to-chat: the user's own WhatsApp sends it, so this records that
        // the message was handed over, not a delivery receipt.
        status: "SENT",
        sentAt: new Date(),
      },
    });
  });

  if (!result) {
    return NextResponse.json({ error: "Rate limit: Max 3 WhatsApp notifications per hour" }, { status: 429 });
  }

  await logAudit(
    "AlertDelivery",
    result.id,
    "WHATSAPP_DISPATCH_PREVIEW_SENT",
    null,
    { orderNo: payload.orderNo, truckNo: payload.truckNo },
    actor.user.id,
  ).catch(() => undefined);

  return NextResponse.json({ success: true, alertId: result.id, shareUrl });
}
