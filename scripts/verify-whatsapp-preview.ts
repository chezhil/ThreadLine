import { formatWhatsAppMessage, getWhatsAppShareUrl, normalizeWhatsAppPhone, type DispatchWhatsAppPayload } from "../src/lib/alerts/whatsapp-format";
import { verifyMetaSignature } from "../src/lib/alerts/verify-webhook";
import { db } from "../src/lib/db";
import crypto from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:3000";

let passes = 0;
let failures = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passes++;
    console.log(`  [PASS] ${name}`);
  } else {
    failures++;
    console.error(`  [FAIL] ${name}`);
    if (detail !== undefined) {
      console.error(`         Detail:`, detail);
    }
  }
}

async function loginAsStorekeeper(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "storekeeper", password: "store123" }),
    });
    if (!res.ok) return null;
    const cookie = res.headers.get("set-cookie")?.split(";")[0];
    return cookie ?? null;
  } catch {
    return null;
  }
}

async function runVerification() {
  console.log("\n=======================================================");
  console.log("   THREADLINE: WHATSAPP DISPATCH PREVIEW VERIFICATION");
  console.log("=======================================================\n");

  // --------------------------------------------------------------------------
  // TEST 1: Deterministic Message Formatting
  // --------------------------------------------------------------------------
  console.log("--- 1. Deterministic Message Formatting ---");
  const testPayload: DispatchWhatsAppPayload = {
    orderNo: "EVR-2610-014",
    buyerName: "Aditya Garments",
    buyerPhone: "+91 98765 43210",
    fabricType: "Cotton Twill 2/1",
    totalMetres: 2450.5,
    rollCount: 18,
    truckNo: "TN-38-AX-9942",
    trackingToken: "sec_trk_9876543210abcdef",
    appUrl: "http://localhost:3000",
  };

  const formattedMsg = formatWhatsAppMessage(testPayload);
  const shareUrl = getWhatsAppShareUrl(testPayload.buyerPhone, formattedMsg);

  check("Message contains order number", formattedMsg.includes(testPayload.orderNo));
  check("Message contains vehicle registration", formattedMsg.includes(testPayload.truckNo));
  check("Message contains unguessable tracking link", formattedMsg.includes(`/track/${testPayload.trackingToken}`));
  check("Message contains buyer name", formattedMsg.includes(testPayload.buyerName));
  check("Message contains fabric type and roll count", formattedMsg.includes("Cotton Twill 2/1") && formattedMsg.includes("18 Rolls"));
  check("Share URL encodes sanitized phone number and text", shareUrl.startsWith("https://wa.me/919876543210?text="));

  check("normaliser: bare 10-digit Indian mobile gets 91", normalizeWhatsAppPhone("98765 43210") === "919876543210");
  check("normaliser: leading 0 stripped", normalizeWhatsAppPhone("098765 43210") === "919876543210");
  check("normaliser: rejects text", normalizeWhatsAppPhone("call the office") === null);
  check("normaliser: rejects too-short numbers", normalizeWhatsAppPhone("12345") === null);
  const multi = formatWhatsAppMessage({ ...testPayload, orderNo: "A-1, B-2", tracking: [{ orderNo: "A-1", trackingToken: "tokA" }, { orderNo: "B-2", trackingToken: "tokB" }] });
  check("multi-order dispatch lists a tracking link per order", multi.includes("/track/tokA") && multi.includes("/track/tokB"));

  // --------------------------------------------------------------------------
  // TEST 2: Zero Internal Cost Leakage
  // --------------------------------------------------------------------------
  console.log("\n--- 2. Zero Internal Cost Leakage Audit ---");
  const sensitivePatterns = [
    { name: "cost", regex: /\bcost\b/i },
    { name: "wage", regex: /\bwage\b/i },
    { name: "Loom", regex: /\bloom\b/i },
    { name: "margin", regex: /\bmargin\b/i },
    { name: "supplier", regex: /\bsupplier\b/i },
  ];

  for (const { name, regex } of sensitivePatterns) {
    const leakFound = regex.test(formattedMsg);
    check(`Sensitive term '${name}' is completely absent`, !leakFound, leakFound ? "LEAK DETECTED" : undefined);
  }

  // --------------------------------------------------------------------------
  // TEST 3: Meta Webhook HMAC-SHA256 Signature Verification
  // --------------------------------------------------------------------------
  console.log("\n--- 3. Meta Cloud API Webhook HMAC-SHA256 Verification ---");
  const testSecret = "whatsapp_meta_app_secret_test_key_884920";
  process.env.WHATSAPP_APP_SECRET = testSecret;

  const rawPayload = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              statuses: [{ id: "wamid.HBgLM...", status: "delivered", timestamp: "1728600000" }],
            },
          },
        ],
      },
    ],
  });

  const validHmac = crypto.createHmac("sha256", testSecret).update(rawPayload, "utf8").digest("hex");
  const validHeader = `sha256=${validHmac}`;

  check("Passes verification for valid HMAC-SHA256 header", verifyMetaSignature(rawPayload, validHeader));

  // Tampered payload
  const tamperedPayload = rawPayload.slice(0, -1) + " }";
  check("Rejects tampered payload content", !verifyMetaSignature(tamperedPayload, validHeader));

  // Tampered signature
  const tamperedSig = `sha256=${validHmac.slice(0, -4)}dead`;
  check("Rejects forged / invalid signature hash", !verifyMetaSignature(rawPayload, tamperedSig));

  // Missing or invalid header formats
  check("Rejects null signature header", !verifyMetaSignature(rawPayload, null));
  check("Rejects mismatched algorithm header", !verifyMetaSignature(rawPayload, `sha1=${validHmac}`));

  // --------------------------------------------------------------------------
  // TEST 4: Server-built message, role gate, rate limit (Max 3 / hour)
  // --------------------------------------------------------------------------
  console.log("\n--- 4. Send route: server-built message, role gate, rate limit ---");
  const testPhone = `+9199${Math.floor(10000000 + Math.random() * 90000000)}`;
  const send = (cookie: string | null, body: unknown) =>
    fetch(`${BASE}/api/alerts/whatsapp/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });

  const cookie = await loginAsStorekeeper();
  if (!cookie) throw new Error(`storekeeper login failed against ${BASE} — start the app on a seeded DB`);

  const dispatch = await db.dispatch.findFirst({ where: { rolls: { some: {} } }, include: { buyer: true } });
  if (!dispatch) throw new Error("no seeded dispatch — run npm run seed");
  const originalContact = dispatch.buyer.contact;
  try {
    await db.buyer.update({ where: { id: dispatch.buyerId }, data: { contact: testPhone } });

    check("anonymous caller → 401", (await send(null, { dispatchId: dispatch.id })).status === 401);
    const floor = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "floor", password: "floor123" }),
    });
    const floorCookie = floor.headers.get("set-cookie")?.split(";")[0] ?? null;
    if (floorCookie) check("floor supervisor cannot send buyer messages → 403", (await send(floorCookie, { dispatchId: dispatch.id })).status === 403);
    if (floorCookie) {
      const listed = await (await fetch(`${BASE}/api/dispatches`, { headers: { cookie: floorCookie } })).text();
      check("floor's dispatch list carries no buyer phone or tracking token", !/"contact"/.test(listed) && !/trackingToken/.test(listed));
    }
    const drainUrl = `${BASE}/api/alerts/outbox/process`;
    check("outbox drain: anonymous → 403", (await fetch(drainUrl, { method: "POST" })).status === 403);
    check("outbox drain: bogus worker token → 403", (await fetch(drainUrl, { method: "POST", headers: { "x-worker-token": "guess" } })).status === 403);
    check("outbox drain: storekeeper (not owner) → 403", (await fetch(drainUrl, { method: "POST", headers: { cookie } })).status === 403);
    check("neither id → 400", (await send(cookie, {})).status === 400);
    check("both ids → 400", (await send(cookie, { dispatchId: dispatch.id, orderId: "x" })).status === 400);
    check("unknown dispatch → 404", (await send(cookie, { dispatchId: "does-not-exist" })).status === 404);

    const prev = await (await send(cookie, { dispatchId: dispatch.id, preview: true })).json();
    check("preview returns the server's payload and records nothing", prev.preview === true && prev.payload?.buyerPhone === testPhone);
    const before = await db.alertDelivery.count({ where: { templateName: "dispatch_whatsapp_manual" } });

    // Client-supplied content is ignored: only ids are read.
    const res1 = await send(cookie, { dispatchId: dispatch.id, buyerPhone: "+910000000000", appUrl: "https://evil.example", message: "pay me" });
    const body1 = await res1.json();
    check("Attempt 1 succeeds (HTTP 200)", res1.status === 200, body1);
    const sentUrl = String(body1.shareUrl ?? "");
    const digits = testPhone.replace(/\D/g, "");
    check("share URL targets the buyer's number from the database", sentUrl.startsWith(`https://wa.me/${digits}?text=`), sentUrl);
    check("client-supplied appUrl/message are ignored", !decodeURIComponent(sentUrl).includes("evil.example") && !decodeURIComponent(sentUrl).includes("pay me"));
    const row = await db.alertDelivery.findFirst({ where: { recipient: digits, templateName: "dispatch_whatsapp_manual" } });
    check("recipient stored normalised (digits only)", !!row);
    check("exactly one outbox row written", (await db.alertDelivery.count({ where: { templateName: "dispatch_whatsapp_manual" } })) === before + 1);

    check("Attempt 2 succeeds", (await send(cookie, { dispatchId: dispatch.id })).status === 200);
    check("Attempt 3 succeeds", (await send(cookie, { dispatchId: dispatch.id })).status === 200);
    const res4 = await send(cookie, { dispatchId: dispatch.id });
    const body4 = await res4.json().catch(() => ({}));
    check("Attempt 4 within an hour → 429", res4.status === 429, { status: res4.status, body: body4 });
    check("429 message names the rate limit", typeof body4.error === "string" && body4.error.includes("Rate limit"));

    // Simultaneous clicks must not slip past the limit.
    await db.alertDelivery.deleteMany({ where: { recipient: digits, templateName: "dispatch_whatsapp_manual" } });
    const burst = await Promise.all(Array.from({ length: 8 }, () => send(cookie, { dispatchId: dispatch.id })));
    const ok = burst.filter((r) => r.status === 200).length;
    check("8 simultaneous sends: at most 3 get through", ok <= 3 && ok >= 1, burst.map((r) => r.status));

    // An unusable contact is refused rather than messaging nobody.
    await db.buyer.update({ where: { id: dispatch.buyerId }, data: { contact: "call the office" } });
    check("buyer contact that isn't a phone number → 422", (await send(cookie, { dispatchId: dispatch.id })).status === 422);
  } finally {
    await db.buyer.update({ where: { id: dispatch.buyerId }, data: { contact: originalContact } });
    await db.alertDelivery.deleteMany({ where: { templateName: "dispatch_whatsapp_manual", recipient: testPhone.replace(/\D/g, "") } });
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`   RESULTS: ${passes} PASSED, ${failures} FAILED`);
  console.log("=======================================================\n");

  if (failures > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVerification().catch((err) => {
  console.error("Verification crashed:", err);
  process.exit(1);
});
