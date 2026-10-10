import { db } from "../db";
import { Prisma } from "@prisma/client";

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

  const payloadStr =
    typeof opts.payload === "string"
      ? opts.payload
      : JSON.stringify(opts.payload);

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

/**
 * Delivery adapter interface. In development / local environment,
 * simulates delivery with high fidelity.
 */
export async function deliverAlert(alert: {
  id: string;
  channel: string;
  recipient: string;
  payload: string;
  templateName: string | null;
}): Promise<{ success: boolean; error?: string }> {
  // Simulate channel delivery or network failure simulation
  try {
    JSON.parse(alert.payload); // a payload that isn't valid JSON counts as a failed delivery
    // Simulated failure test case if recipient is marked 'FAIL' or invalid
    if (alert.recipient.includes("invalid") || alert.recipient === "simulate-failure") {
      throw new Error(`Carrier rejected destination recipient: ${alert.recipient}`);
    }

    // In dev / production simulator, log successful dispatch
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

  // Find alerts due for delivery
  const pendingAlerts = await db.alertDelivery.findMany({
    where: {
      status: { in: ["PENDING", "RETRYING"] },
      scheduledFor: { lte: now },
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const alert of pendingAlerts) {
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
        },
      });
      sent++;
    } else {
      const isExhausted = attempts >= alert.maxAttempts;
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
    processed: pendingAlerts.length,
    sent,
    failed,
    retried,
  };
}
