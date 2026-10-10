import { db } from "../db";
import { Prisma } from "@prisma/client";
import { messageForAlert, sendWhatsAppText, whatsappConfigured } from "./whatsapp-cloud";

const SEND_LEASE_MS = 5 * 60 * 1000;

export type AlertChannel = "WHATSAPP" | "EMAIL" | "SMS" | "IN_APP";

export interface EnqueueAlertOptions {
  channel: AlertChannel;
  recipient: string;
  payload: Record<string, unknown> | string;
  templateName?: string;
  notificationId?: string;
  scheduledFor?: Date;
}

export async function enqueueAlert(
  channelOrOptions: AlertChannel | EnqueueAlertOptions,
  recipientOrTx?: string | Prisma.TransactionClient,
  payload?: Record<string, unknown> | string,
  templateName?: string,
  tx?: Prisma.TransactionClient
) {
  let opts: EnqueueAlertOptions;
  let client: Prisma.TransactionClient | typeof db = db;

  if (typeof channelOrOptions === "object") {
    opts = channelOrOptions;
    if (recipientOrTx && typeof recipientOrTx === "object" && !("length" in recipientOrTx)) {
      client = recipientOrTx as Prisma.TransactionClient;
    }
  } else {
    opts = {
      channel: channelOrOptions,
      recipient: recipientOrTx as string,
      payload: payload ?? {},
      templateName,
    };
    if (tx) {
      client = tx;
    }
  }

  // Always store JSON: a plain-text payload becomes { message }, so the
  // delivery step (which parses it) doesn't fail every string payload.
  const payloadStr = JSON.stringify(typeof opts.payload === "string" ? { message: opts.payload } : opts.payload);

  return client.alertDelivery.create({
    data: {
      channel: opts.channel,
      recipient: opts.recipient,
      payload: payloadStr,
      templateName: opts.templateName ?? null,
      notificationId: opts.notificationId ?? null,
      status: "PENDING",
      attempts: 0,
      scheduledFor: opts.scheduledFor ?? new Date(),
    },
  });
}

export interface DeliveryResult {
  success: boolean;
  error?: string;
  /** Retrying can't help (bad number, rejected by the provider): fail now. */
  permanent?: boolean;
  /** Provider's id for the message, used to match webhook receipts. */
  providerMessageId?: string;
}

/**
 * Delivery adapter. WhatsApp alerts go out through the Cloud API when
 * WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID are configured; every other
 * channel (and WhatsApp with no credentials) is simulated so the queue, retry
 * and backoff behaviour still run end to end in development.
 */
export async function deliverAlert(alert: {
  id: string;
  channel: string;
  recipient: string;
  payload: string;
  templateName: string | null;
}): Promise<DeliveryResult> {
  try {
    const payload = JSON.parse(alert.payload) as Record<string, unknown>; // not valid JSON counts as a failed delivery

    if (alert.channel === "WHATSAPP" && whatsappConfigured()) {
      const text = messageForAlert(alert.templateName, payload);
      if (!text) return { success: false, permanent: true, error: `No WhatsApp message text for template "${alert.templateName ?? "(none)"}"` };
      const sent = await sendWhatsAppText(alert.recipient, text);
      return sent.ok
        ? { success: true, providerMessageId: sent.messageId }
        : { success: false, permanent: sent.permanent, error: sent.error };
    }

    // Simulated failure test case if recipient is marked 'FAIL' or invalid
    if (alert.recipient.includes("invalid") || alert.recipient === "simulate-failure") {
      throw new Error(`Carrier rejected destination recipient: ${alert.recipient}`);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown delivery failure" };
  }
}

/**
 * Background worker that processes and drains pending / retrying alerts from outbox.
 */
export async function processAlertOutbox(batchSize = 25): Promise<{
  processed: number;
  sent: number;
  failed: number;
  retried: number;
}> {
  const now = new Date();

  // Find alerts due for delivery. SENDING rows whose lease ran out belong to
  // a worker that died mid-send and are picked up again.
  const pendingAlerts = await db.alertDelivery.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING", "SENDING"] },
      scheduledFor: { lte: now },
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  let sent = 0;
  let failed = 0;
  let retried = 0;
  let processed = 0;

  for (const alert of pendingAlerts) {
    // Claim the row first (conditional on the state we read), so two
    // workers draining the outbox at once never send the same alert twice.
    const claimed = await db.alertDelivery.updateMany({
      where: { id: alert.id, status: alert.status, scheduledFor: alert.scheduledFor },
      data: { status: "SENDING", scheduledFor: new Date(Date.now() + SEND_LEASE_MS) },
    });
    if (claimed.count !== 1) continue;
    processed++;
    const attempts = alert.attempts + 1;
    const result = await deliverAlert(alert);

    if (result.success) {
      await db.alertDelivery.update({
        where: { id: alert.id },
        data: {
          status: "SENT",
          attempts,
          sentAt: new Date(),
          lastError: null,
          ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        },
      });
      sent++;
    } else {
      const isExhausted = result.permanent || attempts >= alert.maxAttempts;
      // Exponential backoff: 2^attempts * 10 seconds
      const nextDelaySeconds = Math.pow(2, attempts) * 10;
      const nextScheduled = new Date(Date.now() + nextDelaySeconds * 1000);

      await db.alertDelivery.update({
        where: { id: alert.id },
        data: {
          status: isExhausted ? "FAILED" : "RETRYING",
          attempts,
          lastError: result.error,
          scheduledFor: isExhausted ? alert.scheduledFor : nextScheduled,
        },
      });

      if (isExhausted) {
        failed++;
      } else {
        retried++;
      }
    }
  }

  return {
    processed,
    sent,
    failed,
    retried,
  };
}
