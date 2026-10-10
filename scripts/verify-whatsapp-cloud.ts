// WhatsApp Cloud API delivery + receipt webhook, checked against a stand-in
// for Meta's Graph API (same request/response shape), so no real credentials
// or quota are needed:
//
//   npx tsx scripts/verify-whatsapp-cloud.ts
//
// Covers: outbox sends through the Cloud API when configured (and stays
// simulated when not), the exact request Meta would receive, permanent vs
// retryable failures, webhook handshake + HMAC check, and receipt handling
// (out-of-order, unknown ids, failures).

import crypto from "crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";

interface GraphCall {
  url: string;
  auth: string | undefined;
  body: { to: string; type: string; text: { body: string } };
}
const calls: GraphCall[] = [];
let respond: (call: GraphCall) => { status: number; json: unknown } = () => ({ status: 500, json: {} });

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const call = { url: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(data || "{}") } as GraphCall;
    calls.push(call);
    const out = respond(call);
    res.statusCode = out.status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(out.json));
  });
});

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 400)}`}`);
  if (!cond) failures++;
}

const APP_SECRET = "test_app_secret_123";
const VERIFY_TOKEN = "test_verify_token";
const sign = (raw: string) => `sha256=${crypto.createHmac("sha256", APP_SECRET).update(raw, "utf8").digest("hex")}`;

async function main() {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  process.env.WHATSAPP_GRAPH_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env.NEXT_PUBLIC_APP_URL = "https://mill.example";

  const { db } = await import("../src/lib/db");
  const { enqueueAlert, processAlertOutbox } = await import("../src/lib/alerts/outbox");
  const { NextRequest } = await import("next/server");
  const route = await import("../src/app/api/webhooks/whatsapp/route");

  const tag = `wa${Date.now()}`;
  const phone = () => `+91 9${Math.floor(100000000 + Math.random() * 899999999)}`;
  const queue = (recipient: string, templateName = "order_dispatched") =>
    enqueueAlert({
      channel: "WHATSAPP",
      recipient,
      templateName,
      payload: { orderNo: `ORD-${tag}`, buyerName: "Test Buyer", truckNo: "TN-01-AB-1234", trackingPath: "/track/tok123" },
    });
  const drain = async () => {
    // only this run's rows: other pending rows in a shared DB must not be sent
    const rows = await db.alertDelivery.findMany({ where: { status: { in: ["PENDING", "RETRYING"] } } });
    const foreign = rows.filter((r) => !r.payload.includes(tag));
    await db.alertDelivery.updateMany({ where: { id: { in: foreign.map((r) => r.id) } }, data: { scheduledFor: new Date(Date.now() + 3_600_000) } });
    const r = await processAlertOutbox(100);
    await Promise.all(foreign.map((f) => db.alertDelivery.update({ where: { id: f.id }, data: { scheduledFor: f.scheduledFor } })));
    return r;
  };
  const get = (id: string) => db.alertDelivery.findUniqueOrThrow({ where: { id } });
  const post = (body: unknown, signature: string | null | "valid" = "valid") => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return route.POST(
      new NextRequest("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        body: raw,
        headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature === "valid" ? sign(raw) : signature } : {}) },
      }),
    );
  };
  const statusEvent = (id: string, status: string, extra: object = {}) => ({
    entry: [{ changes: [{ value: { statuses: [{ id, status, timestamp: "1760000000", ...extra }] } }] }],
  });

  try {
    // ---- 1. Not configured: simulated, nothing leaves the process ----------
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    const sim = await queue(phone());
    await drain();
    check("unconfigured: row is SENT (simulated)", (await get(sim.id)).status === "SENT");
    check("unconfigured: no request reached the Graph API", calls.length === 0);
    check("unconfigured: no provider id recorded", (await get(sim.id)).providerMessageId === null);

    // ---- 2. Configured: real send ------------------------------------------
    process.env.WHATSAPP_ACCESS_TOKEN = "tok_secret";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "10987654321";
    let n = 0;
    respond = () => ({ status: 200, json: { messaging_product: "whatsapp", contacts: [{ wa_id: "x" }], messages: [{ id: `wamid.${tag}.${++n}` }] } });
    const num = phone();
    const row = await queue(num);
    await drain();
    const sent = await get(row.id);
    check("configured: row SENT with provider message id", sent.status === "SENT" && sent.providerMessageId === `wamid.${tag}.1`, sent);
    const call = calls[0];
    check("request goes to /<version>/<phone-number-id>/messages", /^\/v[\d.]+\/10987654321\/messages$/.test(call?.url ?? ""), call?.url);
    check("request carries the bearer token", call?.auth === "Bearer tok_secret");
    check("recipient normalised to digits with country code", call?.body.to === num.replace(/\D/g, ""), call?.body.to);
    check("text message with tracking link and truck, no internal data", call?.body.type === "text" && call.body.text.body.includes("https://mill.example/track/tok123") && call.body.text.body.includes("TN-01-AB-1234") && !/cost|wage|margin|loom/i.test(call.body.text.body), call?.body.text.body);

    // ---- 3. Failures: retryable vs permanent -------------------------------
    calls.length = 0;
    respond = () => ({ status: 503, json: { error: { message: "Service unavailable", code: 2 } } });
    const retry = await queue(phone());
    await drain();
    const r1 = await get(retry.id);
    check("5xx: scheduled for retry, not failed", r1.status === "RETRYING" && r1.attempts === 1 && /unavailable/i.test(r1.lastError ?? ""), r1);

    respond = () => ({ status: 400, json: { error: { message: "Recipient phone number not in allowed list", code: 131030 } } });
    const perm = await queue(phone());
    await drain();
    const r2 = await get(perm.id);
    check("4xx: fails immediately (no pointless retries)", r2.status === "FAILED" && r2.attempts === 1 && /131030/.test(r2.lastError ?? ""), r2);

    calls.length = 0;
    const bad = await queue("call the office");
    await drain();
    const r3 = await get(bad.id);
    check("unusable phone: fails permanently without calling Meta", r3.status === "FAILED" && calls.length === 0, { r3, calls: calls.length });

    const noText = await queue(phone(), "some_unknown_template");
    await drain();
    check("unknown template: fails permanently, nothing sent", (await get(noText.id)).status === "FAILED" && calls.length === 0);

    // ---- 3b. Approved templates ---------------------------------------------
    respond = () => ({ status: 200, json: { messages: [{ id: `wamid.${tag}.${++n}` }] } });
    process.env.WHATSAPP_TEMPLATE_ORDER_DISPATCHED = "order_dispatched_v1";
    calls.length = 0;
    const tpl = await enqueueAlert({
      channel: "WHATSAPP",
      recipient: phone(),
      templateName: "order_dispatched",
      payload: { orderNo: `ORD-${tag}`, buyerName: "Test\nBuyer\t Ltd", trackingPath: "/track/tok123" }, // no truck, newline in name
    });
    await drain();
    const tc = calls[0] as unknown as { body: { type: string; template: { name: string; language: { code: string }; components: { type: string; parameters: { type: string; text: string }[] }[] } } };
    check("template configured: sent as a template message", tc?.body.type === "template" && tc.body.template.name === "order_dispatched_v1" && tc.body.template.language.code === "en", tc?.body);
    const params = tc?.body.template.components[0].parameters.map((x) => x.text);
    check("template params: ordered, newlines flattened, missing value becomes '-'", JSON.stringify(params) === JSON.stringify(["Test Buyer Ltd", `ORD-${tag}`, "-", "https://mill.example/track/tok123"]), params);
    check("template send stores the provider id", !!(await get(tpl.id)).providerMessageId);
    delete process.env.NEXT_PUBLIC_APP_URL;
    calls.length = 0;
    await queue(phone());
    await drain();
    const noLink = calls[0] as unknown as typeof tc;
    check("no public URL configured: link param is '-', never empty", noLink?.body.template.components[0].parameters.at(-1)?.text === "-");
    process.env.NEXT_PUBLIC_APP_URL = "https://mill.example";
    delete process.env.WHATSAPP_TEMPLATE_ORDER_DISPATCHED;
    calls.length = 0;
    await queue(phone());
    await drain();
    check("no template configured: falls back to plain text", calls[0]?.body.type === "text");

    // ---- 3c. Outbox drain endpoint auth ------------------------------------
    const proc = await import("../src/app/api/alerts/outbox/process/route");
    const hit = (headers: Record<string, string> = {}) => proc.POST(new NextRequest("http://localhost/api/alerts/outbox/process", { method: "POST", headers }));
    process.env.ALERT_WORKER_TOKEN = "worker_tok_123";
    check("drain: right worker token → 200 (wrong/no token cases are checked over HTTP in verify-whatsapp-preview)", (await hit({ "x-worker-token": "worker_tok_123" })).status === 200);
    delete process.env.ALERT_WORKER_TOKEN;

    // ---- 4. Webhook handshake ----------------------------------------------
    const hs = (qs: string) => route.GET(new NextRequest(`http://localhost/api/webhooks/whatsapp?${qs}`));
    const ok = await hs(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=abc123`);
    check("handshake: right token echoes the challenge", ok.status === 200 && (await ok.text()) === "abc123");
    check("handshake: wrong token → 403", (await hs("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123")).status === 403);
    check("handshake: missing token → 403", (await hs("hub.mode=subscribe&hub.challenge=abc123")).status === 403);
    delete process.env.WHATSAPP_VERIFY_TOKEN;
    check("handshake: no token configured → 403 even for an empty token", (await hs("hub.mode=subscribe&hub.verify_token=&hub.challenge=abc123")).status === 403);
    process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

    // ---- 5. Webhook signature ----------------------------------------------
    const id = sent.providerMessageId!;
    const ev = statusEvent(id, "delivered");
    check("webhook: missing signature → 401", (await post(ev, null)).status === 401);
    check("webhook: forged signature → 401", (await post(ev, `sha256=${"0".repeat(64)}`)).status === 401);
    check("webhook: signature over a different body → 401", (await post(ev, sign(JSON.stringify(statusEvent(id, "read"))))).status === 401);
    check("forged requests changed nothing", (await get(sent.id)).receipt === null);
    delete process.env.WHATSAPP_APP_SECRET;
    check("webhook: no app secret configured → 401, never open", (await post(ev, sign(JSON.stringify(ev)))).status === 401);
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    check("webhook: signed but not JSON → 400", (await post("not json")).status === 400);

    // ---- 6. Receipts ----------------------------------------------------------
    check("signed 'delivered' → 200", (await post(ev)).status === 200);
    let r = await get(sent.id);
    check("delivered receipt recorded", r.receipt === "DELIVERED" && !!r.deliveredAt && r.readAt === null, r);
    check("'read' upgrades it", (await post(statusEvent(id, "read"))).status === 200 && (await get(sent.id)).receipt === "READ");
    await post(statusEvent(id, "delivered"));
    check("a late 'delivered' never downgrades 'read'", (await get(sent.id)).receipt === "READ");
    await post(statusEvent(id, "failed", { errors: [{ code: 131026, title: "Message undeliverable" }] }));
    check("a stale 'failed' after read is ignored", (await get(sent.id)).receipt === "READ" && (await get(sent.id)).status === "SENT");

    respond = () => ({ status: 200, json: { messages: [{ id: `wamid.${tag}.${++n}` }] } });
    // read arriving before delivered fills in both timestamps
    const row2 = await queue(phone());
    await drain();
    const id2 = (await get(row2.id)).providerMessageId!;
    await post(statusEvent(id2, "read"));
    r = await get(row2.id);
    check("read-before-delivered still stamps both times", r.receipt === "READ" && !!r.readAt && !!r.deliveredAt, r);

    // failed receipt on a never-delivered message
    const row3 = await queue(phone());
    await drain();
    const id3 = (await get(row3.id)).providerMessageId!;
    await post(statusEvent(id3, "failed", { errors: [{ code: 131047, title: "Re-engagement message" }] }));
    r = await get(row3.id);
    check("failed receipt marks the row FAILED with Meta's reason", r.status === "FAILED" && r.receipt === "FAILED" && /131047/.test(r.lastError ?? ""), r);
    await post(statusEvent(id3, "delivered"));
    r = await get(row3.id);
    check("a later delivered receipt corrects an earlier failure", r.status === "SENT" && r.receipt === "DELIVERED" && r.lastError === null, r);

    const unknown = await post(statusEvent("wamid.unknown", "delivered"));
    check("unknown message id → 200, nothing applied", unknown.status === 200 && (await unknown.json()).applied === 0);
    const batch = await post({ entry: [{ changes: [{ value: { statuses: [{ id: id2, status: "delivered" }, { id: "wamid.zzz", status: "read" }, { status: "read" }, { id: id2 }] } }] }] });
    check("malformed/mixed batch is tolerated", batch.status === 200);
    const noStatuses = await post({ entry: [{ changes: [{ value: { messages: [{ from: "1", text: { body: "hi" } }] } }] }] });
    check("inbound-message events (no statuses) → 200", noStatuses.status === 200);
  } finally {
    await db.alertDelivery.deleteMany({ where: { payload: { contains: tag } } });
    await db.$disconnect();
    server.close();
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
