import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { verifyMetaSignature } from "@/lib/alerts/verify-webhook";

// Meta calls this (no session — it is not a logged-in user), so it is public in
// proxy.ts and protected by Meta's own scheme instead:
//   GET  — one-time subscription handshake, checked against WHATSAPP_VERIFY_TOKEN
//   POST — delivery receipts, accepted only with a valid X-Hub-Signature-256
//          (HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET)

export const instant = false;

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function GET(req: NextRequest) {
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  const q = req.nextUrl.searchParams;
  const token = q.get("hub.verify_token");
  if (expected && q.get("hub.mode") === "subscribe" && token && safeEqual(token, expected)) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

interface StatusEvent {
  id?: string;
  status?: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string }[];
}

export async function POST(req: NextRequest) {
  // The signature covers the exact bytes Meta sent, so read the raw text and
  // parse it ourselves afterwards.
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: { entry?: { changes?: { value?: { statuses?: StatusEvent[] } }[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let applied = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const ev of change.value?.statuses ?? []) {
        if (!ev.id || !ev.status) continue;
        if (await applyReceipt(ev)) applied++;
      }
    }
  }
  // Always 200 once the signature is good, even for ids we don't know, or Meta
  // keeps retrying receipts that can never match.
  return NextResponse.json({ ok: true, applied });
}

async function applyReceipt(ev: StatusEvent): Promise<boolean> {
  const row = await db.alertDelivery.findUnique({ where: { providerMessageId: ev.id! } });
  if (!row) return false;
  const at = ev.timestamp && /^\d+$/.test(ev.timestamp) ? new Date(Number(ev.timestamp) * 1000) : new Date();

  if (ev.status === "failed") {
    // A failed receipt after delivery/read would be stale noise; ignore it.
    if (row.receipt === "DELIVERED" || row.receipt === "READ") return false;
    const e = ev.errors?.[0];
    const reason = e ? `${e.title ?? e.message ?? "failed"} (code ${e.code ?? "?"})` : "WhatsApp reported the message failed";
    await db.alertDelivery.update({ where: { id: row.id }, data: { receipt: "FAILED", status: "FAILED", lastError: reason } });
    return true;
  }

  const rank = RANK[ev.status!];
  if (!rank || rank < 2) return false; // "sent" is already what we recorded
  // Receipts can arrive out of order (read before delivered); never step back.
  const have = row.receipt === "READ" ? 3 : row.receipt === "DELIVERED" ? 2 : 0;
  if (rank <= have) return false;
  const data =
    rank === 3
      ? { receipt: "READ", readAt: at, deliveredAt: row.deliveredAt ?? at }
      : { receipt: "DELIVERED", deliveredAt: at };
  // A late delivered/read receipt proves a row we had marked FAILED did arrive.
  await db.alertDelivery.update({ where: { id: row.id }, data: { ...data, ...(row.status === "FAILED" ? { status: "SENT", lastError: null } : {}) } });
  return true;
}
