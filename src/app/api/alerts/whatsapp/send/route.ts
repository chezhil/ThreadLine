import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { writeTransaction } from "@/lib/concurrency";
import { formatWhatsAppMessage, getWhatsAppShareUrl } from "@/lib/alerts/whatsapp-format";

export const instant = false;

const sendWhatsAppAlertSchema = z.object({
  orderNo: z.string().trim().min(1, "orderNo is required"),
  buyerName: z.string().trim().min(1, "buyerName is required"),
  buyerPhone: z.string().trim().min(1, "buyerPhone is required"),
  fabricType: z.string().trim().min(1, "fabricType is required"),
  totalMetres: z.number().nonnegative(),
  rollCount: z.number().int().nonnegative(),
  truckNo: z.string().trim().min(1, "truckNo is required"),
  trackingToken: z.string().trim().min(1, "trackingToken is required"),
  appUrl: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = sendWhatsAppAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const payload = parsed.data;
  const recipientPhone = payload.buyerPhone;
  const cleanPhone = recipientPhone.replace(/\D/g, "");

  // Rate Limiting Protocol: Max 3 WhatsApp notifications per hour per recipient
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recentAlertsCount = await db.alertDelivery.count({
    where: {
      recipient: { in: [recipientPhone, cleanPhone] },
      createdAt: { gte: oneHourAgo },
    },
  });

  if (recentAlertsCount >= 3) {
    return NextResponse.json(
      { error: "Rate limit: Max 3 WhatsApp notifications per hour" },
      { status: 429 }
    );
  }

  // Sanitized message formatting — zero internal costs, wages, machines, or margins
  const messageText = formatWhatsAppMessage(payload);
  const shareUrl = getWhatsAppShareUrl(recipientPhone, messageText);

  const sanitizedPayload = {
    orderNo: payload.orderNo,
    buyerName: payload.buyerName,
    buyerPhone: payload.buyerPhone,
    fabricType: payload.fabricType,
    totalMetres: payload.totalMetres,
    rollCount: payload.rollCount,
    truckNo: payload.truckNo,
    trackingToken: payload.trackingToken,
    message: messageText,
  };

  // Transactional Persistence: record dispatch alert directly into AlertDelivery outbox
  const alert = await writeTransaction(async (tx) => {
    return tx.alertDelivery.create({
      data: {
        channel: "WHATSAPP",
        recipient: recipientPhone,
        payload: JSON.stringify(sanitizedPayload),
        status: "SENT",
        sentAt: new Date(),
      },
    });
  });

  return NextResponse.json({
    success: true,
    alertId: alert.id,
    shareUrl,
  });
}
