// End-to-end checks for correcting records: edit / archive / delete of
// master data, orders, production and attendance, and reverse-and-correct
// for payments, expenses, invoices and QC inspections — against a running
// server, plus ledger invariants read straight from the database.
//
//   BASE=http://localhost:3000 DATABASE_URL="file:./dev.db" npx tsx scripts/verify-crud.ts
//
// Writes real rows; run it against a freshly seeded scratch database.
import { PrismaClient } from "@prisma/client";
import { check, client, firstError, istToday, login, report, uniq, type Client } from "./lib/api-check";
import { ledgerInvariants } from "./lib/invariants";

const db = new PrismaClient();

interface Named {
  id: string;
  name: string;
  archivedAt: string | null;
}
interface Order {
  id: string;
  orderNo: string;
  status: string;
  productionStatus: string;
  qtyMetres: number;
  pricePerMetre: number;
  colour: string;
  feasibilityResult: string | null;
}
interface Lot {
  id: string;
  qtyReceivedKg: number;
  qtyRemainingKg: number;
}
interface WorkOrder {
  id: string;
  status: string;
  producedQty: number;
}
interface Invoice {
  id: string;
  invoiceNo: string;
  subtotal: number;
  total: number;
}
interface Payment {
  id: string;
  amount: number;
}
interface Reversal {
  id: string;
  replacementId: string | null;
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const ledgerFor = (sourceType: string, sourceId: string) =>
  db.ledgerEntry.findMany({ where: { sourceType, sourceId }, orderBy: { createdAt: "asc" } });

async function main() {
  const owner = client(await login("owner", "owner123"));
  const store = client(await login("storekeeper", "store123"));
  const floor = client(await login("floor", "floor123"));
  const qc = client(await login("qc", "qc123"));
  const anon = client(null);
  const forged = client(`threadline_session=${"A".repeat(43)}`);

  const buyerId = await buyers(owner, store, anon, forged);
  const { yarnTypeId, supplierId } = await inventory(owner, store, floor);
  await orders(owner, store, buyerId, yarnTypeId);
  const production = await productionFlow(owner, store, floor, qc, buyerId, yarnTypeId, supplierId);
  await money(owner, store, production.orderId);
  await attendance(owner);
  await hostileInput(owner);
  await invariants();

  report();
  await db.$disconnect();
}

// ----------------------------------------------------------------- buyers
async function buyers(owner: Client, store: Client, anon: Client, forged: Client): Promise<string> {
  console.log("\n# Buyers");
  const name = uniq("Verify Buyer");
  const created = await owner<{ buyer: Named & { gstin: string | null } }>("POST", "/api/buyers", {
    name: `  ${name}  `,
    contact: "+91 90000 99999",
    gstin: "27aasfs1234a1z5",
  });
  check("owner creates a buyer (201)", created.status === 201, created.json);
  const buyer = created.json!.buyer;
  check("name is trimmed and GSTIN upper-cased", buyer.name === name && buyer.gstin === "27AASFS1234A1Z5", buyer);
  check("blank name → 400", (await owner("POST", "/api/buyers", { name: "   ", contact: "x" })).status === 400);
  check("10,000-character name → 400", (await owner("POST", "/api/buyers", { name: "x".repeat(10_000), contact: "x" })).status === 400);
  check("malformed GSTIN → 400", (await owner("POST", "/api/buyers", { name: uniq("B"), contact: "x", gstin: "NOTAGSTIN" })).status === 400);
  check("malformed JSON → 400", (await owner("POST", "/api/buyers", "{")).status === 400);
  check("duplicate name → 409", (await owner("POST", "/api/buyers", { name, contact: "x" })).status === 409);
  check("storekeeper can't create buyers (403)", (await store("POST", "/api/buyers", { name: uniq("B"), contact: "x" })).status === 403);
  check("signed out → 401", (await anon("POST", "/api/buyers", { name: uniq("B"), contact: "x" })).status === 401);
  check("forged session cookie → 403", (await forged("GET", "/api/buyers")).status === 403);
  const unicode = await owner<{ buyer: Named }>("POST", "/api/buyers", { name: `श्री गणेश टेक्सटाइल्स 🧵 ${Date.now()}`, contact: "+91 98" });
  check("unicode buyer name round-trips", unicode.status === 201 && unicode.json!.buyer.name.startsWith("श्री गणेश"), unicode.json);

  const path = `/api/buyers/${buyer.id}`;
  const renamed = uniq("Verify Buyer Renamed");
  const edit = await owner<{ buyer: Named & { address: string | null } }>("PATCH", path, { name: renamed, address: "Erode, TN" });
  check("owner edits a buyer", edit.status === 200 && edit.json!.buyer.name === renamed && edit.json!.buyer.address === "Erode, TN", edit.json);
  const kept = await db.buyer.findUniqueOrThrow({ where: { id: buyer.id } });
  check("a field left out of the edit is kept (GSTIN)", kept.gstin === "27AASFS1234A1Z5", kept);
  check("rename onto another buyer's name → 409", (await owner("PATCH", path, { name: "Rajesh Garments" })).status === 409);
  check("empty edit → 400", (await owner("PATCH", path, {})).status === 400);
  check("unknown buyer → 404", (await owner("PATCH", "/api/buyers/does-not-exist", { contact: "y" })).status === 404);
  check("storekeeper can't edit buyers (403)", (await store("PATCH", path, { contact: "y" })).status === 403);
  check("edit is audited", (await db.auditLog.count({ where: { entity: "Buyer", entityId: buyer.id, action: "update" } })) === 1);

  const archived = await owner<{ buyer: Named }>("PATCH", path, { archived: true });
  check("buyer archived", archived.status === 200 && !!archived.json!.buyer.archivedAt, archived.json);
  const blocked = await owner("POST", "/api/orders", orderBody(buyer.id));
  check("an archived buyer can't get a new order (400)", blocked.status === 400 && /archived/.test(firstError(blocked.json)), blocked.json);
  const restored = await owner<{ buyer: Named }>("PATCH", path, { archived: false });
  check("buyer restored", restored.status === 200 && restored.json!.buyer.archivedAt === null, restored.json);

  const seeded = await db.buyer.findFirstOrThrow({ where: { orders: { some: {} } } });
  const inUse = await owner("DELETE", `/api/buyers/${seeded.id}`);
  check("a buyer with orders can't be deleted (409, reason given)", inUse.status === 409 && /order/.test(firstError(inUse.json)), inUse.json);
  const spare = await owner<{ buyer: Named }>("POST", "/api/buyers", { name: uniq("Spare Buyer"), contact: "x" });
  const del = await owner("DELETE", `/api/buyers/${spare.json!.buyer.id}`);
  check("an unused buyer is deleted", del.status === 200, del.json);
  check("deleting it again → 404", (await owner("DELETE", `/api/buyers/${spare.json!.buyer.id}`)).status === 404);
  check("delete is audited", (await db.auditLog.count({ where: { entity: "Buyer", entityId: spare.json!.buyer.id, action: "delete" } })) === 1);
  return buyer.id;
}

function orderBody(buyerId: string, extra: Record<string, unknown> = {}) {
  return { buyerId, fabricType: "Poplin", colour: "White", gsm: 120, qtyMetres: 200, pricePerMetre: 100, deadline: future(30), ...extra };
}

// -------------------------------------------------------------- inventory
async function inventory(owner: Client, store: Client, floor: Client) {
  console.log("\n# Suppliers, yarn types and lots");
  const supplier = await store<{ supplier: Named }>("POST", "/api/suppliers", { name: uniq("Verify Supplier"), contact: "+91 98 1", gstin: "" });
  check("storekeeper creates a supplier", supplier.status === 201 && supplier.json!.supplier, supplier.json);
  const supplierId = supplier.json!.supplier.id;
  check("floor can't touch suppliers (403)", (await floor("PATCH", `/api/suppliers/${supplierId}`, { contact: "y" })).status === 403);
  check("storekeeper edits a supplier", (await store("PATCH", `/api/suppliers/${supplierId}`, { contact: "+91 98 2" })).status === 200);
  const seededSupplier = await db.supplier.findFirstOrThrow({ where: { yarnLots: { some: {} } } });
  check("a supplier with lots can't be deleted (409)", (await store("DELETE", `/api/suppliers/${seededSupplier.id}`)).status === 409);

  const typeName = uniq("Verify Yarn");
  const type = await store<{ yarnType: Named }>("POST", "/api/yarn-types", {
    name: typeName,
    count: "30s",
    material: "Cotton",
    colour: "Ecru",
    lowStockThresholdKg: "50",
    costPerKg: "200",
  });
  check("storekeeper creates a yarn type (numbers from form strings)", type.status === 201, type.json);
  const yarnTypeId = type.json!.yarnType.id;
  check("same name/count/colour → 409", (await store("POST", "/api/yarn-types", { name: typeName, count: "30s", material: "x", colour: "Ecru", lowStockThresholdKg: 1, costPerKg: 1 })).status === 409);
  check("negative cost → 400", (await store("POST", "/api/yarn-types", { name: uniq("Y"), count: "1", material: "x", colour: "x", lowStockThresholdKg: 1, costPerKg: -1 })).status === 400);

  const lotNo = uniq("LOT");
  const lotBody = { yarnTypeId, supplierId, lotNo, qtyReceivedKg: 100, receivedAt: istToday() };
  const lot = await store<{ yarnLot: Lot }>("POST", "/api/yarn-lots", lotBody);
  check("intake recorded", lot.status === 201 && lot.json!.yarnLot.qtyRemainingKg === 100, lot.json);
  const lotId = lot.json!.yarnLot.id;
  check("same lot from the same supplier → 409", (await store("POST", "/api/yarn-lots", lotBody)).status === 409);
  check("future received date → 400", (await store("POST", "/api/yarn-lots", { ...lotBody, lotNo: uniq("L"), receivedAt: future(3) })).status === 400);
  check("unparseable received date → 400 (not 500)", (await store("POST", "/api/yarn-lots", { ...lotBody, lotNo: uniq("L"), receivedAt: "garbage" })).status === 400);
  check("quantity 'abc' → 400", (await store("POST", "/api/yarn-lots", { ...lotBody, lotNo: uniq("L"), qtyReceivedKg: "abc" })).status === 400);

  const lowAlert = () => db.notification.findFirst({ where: { type: `low_stock:${yarnTypeId}`, read: false } });
  check("100 kg vs 50 kg threshold: not low", !(await lowAlert()));
  await store("PATCH", `/api/yarn-types/${yarnTypeId}`, { lowStockThresholdKg: 150 });
  check("raising the threshold above stock raises a low-stock alert", !!(await lowAlert()));
  const archived = await store<{ yarnType: Named }>("PATCH", `/api/yarn-types/${yarnTypeId}`, { archived: true });
  check("archiving the yarn type resolves its low-stock alert", archived.status === 200 && !(await lowAlert()), archived.json);
  const lowList = await store<{ lowStock: { yarnTypeId: string }[] }>("GET", "/api/yarn/low-stock");
  check("an archived yarn type isn't listed as low", !lowList.json!.lowStock.some((l) => l.yarnTypeId === yarnTypeId));
  check("no intake for an archived yarn type (400)", (await store("POST", "/api/yarn-lots", { ...lotBody, lotNo: uniq("L") })).status === 400);
  await store("PATCH", `/api/yarn-types/${yarnTypeId}`, { archived: false, lowStockThresholdKg: 50 });
  check("restored at 50 kg threshold: no alert", !(await lowAlert()));

  // Reserve some of the lot for an order, then correct the intake.
  const buyer = await db.buyer.findFirstOrThrow({ where: { archivedAt: null } });
  const order = await owner<{ order: Order }>("POST", "/api/orders", orderBody(buyer.id));
  const orderId = order.json!.order.id;
  await owner("PATCH", `/api/orders/${orderId}`, { status: "CONFIRMED" });
  const reserve = await store<{ reservation: { id: string } }>("POST", `/api/orders/${orderId}/reserve-yarn`, { yarnLotId: lotId, qtyKg: 30 });
  check("30 kg reserved from the lot", reserve.status === 201, reserve.json);
  const lotPath = `/api/yarn-lots/${lotId}`;
  const tooSmall = await store("PATCH", lotPath, { qtyReceivedKg: 20 });
  check("received can't drop below what is reserved (400)", tooSmall.status === 400 && /reserved/.test(firstError(tooSmall.json)), tooSmall.json);
  const bigger = await store<{ yarnLot: Lot }>("PATCH", lotPath, { qtyReceivedKg: 150 });
  check("received 100 → 150 kg moves remaining 70 → 120 kg", bigger.status === 200 && bigger.json!.yarnLot.qtyRemainingKg === 120, bigger.json);
  const otherType = await db.yarnType.findFirstOrThrow({ where: { NOT: { id: yarnTypeId }, archivedAt: null } });
  check("a reserved lot keeps its yarn type (400)", (await store("PATCH", lotPath, { yarnTypeId: otherType.id })).status === 400);
  check("a reserved lot can't be deleted (409)", (await store("DELETE", lotPath)).status === 409);
  check("a yarn type with lots can't be deleted (409)", (await store("DELETE", `/api/yarn-types/${yarnTypeId}`)).status === 409);

  const reservationPath = `/api/orders/${orderId}/reservations/${reserve.json!.reservation.id}`;
  check("floor can't release reservations (403)", (await floor("DELETE", reservationPath)).status === 403);
  const released = await store("DELETE", reservationPath);
  const afterRelease = await db.yarnLot.findUniqueOrThrow({ where: { id: lotId } });
  check("releasing the reservation returns the yarn (150 kg remaining)", released.status === 200 && afterRelease.qtyRemainingKg === 150, { released: released.json, afterRelease });
  check("releasing it again → 404", (await store("DELETE", reservationPath)).status === 404);
  check("the released reservation is audited", (await db.auditLog.count({ where: { entity: "OrderYarnReservation", action: "release" } })) >= 1);
  const deletedLot = await store("DELETE", lotPath);
  check("an unused lot is deleted", deletedLot.status === 200, deletedLot.json);
  check("the order nothing depends on any more is deleted", (await owner("DELETE", `/api/orders/${orderId}`)).status === 200);

  const spareType = await store<{ yarnType: Named }>("POST", "/api/yarn-types", { name: uniq("Spare Yarn"), count: "40s", material: "x", colour: "x", lowStockThresholdKg: 1, costPerKg: 1 });
  check("an unused yarn type is deleted", (await store("DELETE", `/api/yarn-types/${spareType.json!.yarnType.id}`)).status === 200);
  const spareSupplier = await store<{ supplier: Named }>("POST", "/api/suppliers", { name: uniq("Spare Supplier"), contact: "x" });
  check("an unused supplier is deleted", (await store("DELETE", `/api/suppliers/${spareSupplier.json!.supplier.id}`)).status === 200);
  return { yarnTypeId, supplierId };
}

// ------------------------------------------------------------------ orders
async function orders(owner: Client, store: Client, buyerId: string, yarnTypeId: string) {
  console.log("\n# Orders");
  const created = await owner<{ order: Order }>("POST", "/api/orders", orderBody(buyerId, { yarnTypeId, wastagePct: 10 }));
  check("order created with a feasibility check", created.status === 201 && !!created.json!.order.feasibilityResult, created.json);
  const order = created.json!.order;
  const path = `/api/orders/${order.id}`;
  const before = JSON.parse(order.feasibilityResult!) as { yarnNeededKg: number; wastagePct: number };

  const edit = await owner<{ order: Order }>("PATCH", path, { qtyMetres: 400, colour: "Ivory" });
  const after = JSON.parse(edit.json!.order.feasibilityResult!) as { yarnNeededKg: number; wastagePct: number };
  check("NEW order's details edited", edit.status === 200 && edit.json!.order.qtyMetres === 400 && edit.json!.order.colour === "Ivory", edit.json);
  check("feasibility re-run for the new quantity with the same wastage", Math.abs(after.yarnNeededKg - before.yarnNeededKg * 2) < 0.01 && after.wastagePct === 10, { before, after });
  check("deadline in the past → 400", (await owner("PATCH", path, { deadline: "2020-01-01" })).status === 400);
  check("status with other fields → 400", (await owner("PATCH", path, { status: "CONFIRMED", colour: "Red" })).status === 400);
  check("gsm 5 → 400", (await owner("PATCH", path, { gsm: 5 })).status === 400);
  check("storekeeper can't edit orders (403)", (await store("PATCH", path, { colour: "Red" })).status === 403);

  await owner("PATCH", path, { status: "CONFIRMED" });
  const invoice = await owner<{ invoice: Invoice }>("POST", "/api/invoices", { orderId: order.id });
  check("invoice raised for the confirmed order", invoice.status === 201, invoice.json);
  const locked = await owner("PATCH", path, { pricePerMetre: 120 });
  check("price can't change while an invoice is active (409)", locked.status === 409 && /INV-/.test(firstError(locked.json)), locked.json);
  check("a non-billed field still can (colour)", (await owner("PATCH", path, { colour: "Cream" })).status === 200);
  const cancelled = await owner("POST", `/api/invoices/${invoice.json!.invoice.id}/reversal`, { reason: "Raised before the price was agreed" });
  check("the invoice is cancelled (credit note)", cancelled.status === 201, cancelled.json);
  check("…then the price can change", (await owner("PATCH", path, { pricePerMetre: 120 })).status === 200);
  const reissued = await owner<{ invoice: Invoice }>("POST", "/api/invoices", { orderId: order.id });
  check("a fresh invoice is raised at the new price (not the cancelled one)", reissued.status === 201 && reissued.json!.invoice.id !== invoice.json!.invoice.id && reissued.json!.invoice.subtotal === 400 * 120, reissued.json);
  const busy = await owner("DELETE", path);
  check("an order with invoices can't be deleted (409, reason given)", busy.status === 409 && /invoice/.test(firstError(busy.json)), busy.json);

  // Order numbers never collide after a delete.
  const a = await owner<{ order: Order }>("POST", "/api/orders", orderBody(buyerId));
  check("storekeeper can't delete orders (403)", (await store("DELETE", `/api/orders/${a.json!.order.id}`)).status === 403);
  check("an untouched NEW order is deleted", (await owner("DELETE", `/api/orders/${a.json!.order.id}`)).status === 200);
  check("deleting it again → 404", (await owner("DELETE", `/api/orders/${a.json!.order.id}`)).status === 404);
  const seq = (no: string) => Number(no.split("-").pop());
  const highest = Math.max(...(await db.order.findMany({ select: { orderNo: true } })).map((o) => seq(o.orderNo)));
  const b = await owner<{ order: Order }>("POST", "/api/orders", orderBody(buyerId));
  check("the next order number follows the highest one in use", b.status === 201 && seq(b.json!.order.orderNo) === highest + 1, b.json);
  const parallel = await Promise.all(Array.from({ length: 4 }, () => owner<{ order: Order }>("POST", "/api/orders", orderBody(buyerId))));
  const numbers = parallel.map((r) => r.json?.order?.orderNo);
  check("4 orders created at once get 4 distinct numbers", parallel.every((r) => r.status === 201) && new Set(numbers).size === 4, numbers);
  for (const r of [b, ...parallel]) await owner("DELETE", `/api/orders/${r.json!.order.id}`);

  // Two edits of the same order at once both land, one after the other.
  const twin = await Promise.all([owner("PATCH", path, { colour: "Blue" }), owner("PATCH", path, { fabricType: "Twill" })]);
  const merged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
  check("two concurrent edits of different fields both apply", twin.every((r) => r.status === 200) && merged.colour === "Blue" && merged.fabricType === "Twill", merged);
}

// -------------------------------------------------------------- production
async function productionFlow(owner: Client, store: Client, floor: Client, qc: Client, buyerId: string, yarnTypeId: string, supplierId: string) {
  console.log("\n# Production corrections");
  const machine = async (type: string) => {
    const m = await owner<{ id: string }>("POST", "/api/machines", { name: uniq(`Verify ${type}`), type, capacityMetresPerShift: 1000 });
    await owner("PATCH", `/api/machines/${m.json!.id}/status`, { status: "RUNNING" });
    return m.json!.id;
  };
  const [spinner, loom, dyer] = [await machine("spinning"), await machine("loom"), await machine("dyeing")];
  const lot = await store<{ yarnLot: Lot }>("POST", "/api/yarn-lots", { yarnTypeId, supplierId, lotNo: uniq("PLOT"), qtyReceivedKg: 500, receivedAt: istToday() });
  const created = await owner<{ order: Order }>("POST", "/api/orders", orderBody(buyerId, { qtyMetres: 200 }));
  const orderId = created.json!.order.id;
  await owner("PATCH", `/api/orders/${orderId}`, { status: "CONFIRMED" });
  await store("POST", `/api/orders/${orderId}/reserve-yarn`, { yarnLotId: lot.json!.yarnLot.id, qtyKg: 40 });
  const orderRow = () => db.order.findUniqueOrThrow({ where: { id: orderId } });
  const wo = async (stage: string, machineId: string, plannedQty: number) =>
    (await floor<WorkOrder>("POST", "/api/work-orders", { orderId, stage, machineId, plannedQty })).json!;
  const logOutput = async (workOrderId: string, qty: number) =>
    (await floor<{ id: string }>("POST", "/api/production-logs", { workOrderId, shift: "Morning", qtyProduced: qty })).json!;
  const woRow = (id: string) => db.workOrder.findUniqueOrThrow({ where: { id } });

  const first = await wo("spinning", spinner, 200);
  check("first work order puts the order IN_PRODUCTION", (await orderRow()).status === "IN_PRODUCTION");
  const removed = await floor("DELETE", `/api/work-orders/${first.id}`);
  const reverted = await orderRow();
  check("removing the only work order takes the order back to CONFIRMED (not NEW)", removed.status === 200 && reverted.status === "CONFIRMED" && reverted.productionStatus === "NOT_STARTED", reverted);
  check("the status change is audited", (await db.auditLog.count({ where: { entity: "Order", entityId: orderId, action: "status_change", newValue: JSON.stringify({ status: "CONFIRMED" }) } })) >= 2);

  const spin = await wo("spinning", spinner, 200);
  check("re-plan 200 → 210 m", (await floor("PATCH", `/api/work-orders/${spin.id}`, { plannedQty: 210 })).status === 200);
  check("plan beyond the order + 10% → 400", (await floor("PATCH", `/api/work-orders/${spin.id}`, { plannedQty: 500 })).status === 400);
  const wrongType = await floor("PATCH", `/api/work-orders/${spin.id}`, { machineId: loom });
  check("reassigning to a machine of the wrong type → 400", wrongType.status === 400, wrongType.json);

  const l1 = await logOutput(spin.id, 120);
  const listed = await floor<{ logs: { id: string; loggedByName: string }[] }>("GET", `/api/production-logs?workOrderId=${spin.id}`);
  check("output entries list with who logged them", listed.json?.logs.length === 1 && listed.json.logs[0].loggedByName === "floor", listed.json);
  check("listing needs a valid work order id (400)", (await floor("GET", "/api/production-logs?workOrderId=nope")).status === 400);
  check("qc can't list output (403)", (await qc("GET", `/api/production-logs?workOrderId=${spin.id}`)).status === 403);
  const fixed = await floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 150 });
  check("output entry corrected 120 → 150 m", fixed.status === 200 && (await woRow(spin.id)).producedQty === 150, fixed.json);
  check("a correction past the machine's shift capacity → 400", (await floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 2000 })).status === 400);
  check("zero output → 400", (await floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 0 })).status === 400);
  check("re-plan below what's produced → 400", (await floor("PATCH", `/api/work-orders/${spin.id}`, { plannedQty: 100 })).status === 400);
  check("a work order with output can't be deleted (409)", (await floor("DELETE", `/api/work-orders/${spin.id}`)).status === 409);
  const race = await Promise.all([
    floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 140 }),
    floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 130 }),
  ]);
  const raced = await woRow(spin.id);
  const raceLog = await db.productionLog.findUniqueOrThrow({ where: { id: l1.id } });
  check("two corrections at once leave produced = the surviving entry", race.every((r) => r.status === 200) && raced.producedQty === raceLog.qtyProduced, { produced: raced.producedQty, log: raceLog.qtyProduced });
  await floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 150 });

  await logOutput(spin.id, 60);
  check("spinning completes at 210 m", (await woRow(spin.id)).status === "COMPLETED");
  check("a completed work order can't be re-planned (409)", (await floor("PATCH", `/api/work-orders/${spin.id}`, { plannedQty: 205 })).status === 409);
  await floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 100 });
  check("correcting an entry down reopens the completed stage", (await woRow(spin.id)).status === "IN_PROGRESS");
  await logOutput(spin.id, 50);
  check("…and logging the rest completes it again", (await woRow(spin.id)).status === "COMPLETED");

  const weave = await wo("weaving", loom, 200);
  await logOutput(weave.id, 200);
  const reopen = await floor("PATCH", `/api/production-logs/${l1.id}`, { qtyProduced: 90 });
  check("spinning can't be reopened once weaving started (409)", reopen.status === 409 && /weaving/.test(firstError(reopen.json)), reopen.json);

  const mint = async (length: number) =>
    (await floor<{ id: string; qcStatus: string }>("POST", "/api/rolls", { orderId, workOrderId: weave.id, machineId: loom, shift: "Morning", yarnLotId: lot.json!.yarnLot.id, lengthMetres: length, weightKg: 20 })).json!;
  const [r1, r2, r3] = [await mint(100), await mint(100), await mint(50)];
  const editRoll = await floor<{ lengthMetres: number }>("PATCH", `/api/rolls/${r1.id}`, { lengthMetres: 101 });
  check("roll length corrected", editRoll.status === 200 && editRoll.json!.lengthMetres === 101, editRoll.json);
  const foreignLot = await db.yarnLot.findFirstOrThrow({ where: { reservations: { none: { orderId } }, linkedOrderId: null, rolls: { none: { orderId } } } });
  check("a lot not reserved for the order → 400", (await floor("PATCH", `/api/rolls/${r1.id}`, { yarnLotId: foreignLot.id })).status === 400);
  check("storekeeper can't edit rolls (403)", (await store("PATCH", `/api/rolls/${r1.id}`, { weightKg: 1 })).status === 403);
  check("a minted-by-mistake roll is deleted", (await floor("DELETE", `/api/rolls/${r3.id}`)).status === 200);

  const dye = await wo("dyeing", dyer, 200);
  const d1 = await logOutput(dye.id, 200);
  check("dyeing done → production DONE, order in QC", (await orderRow()).productionStatus === "DONE" && (await orderRow()).status === "QC");
  await floor("PATCH", `/api/production-logs/${d1.id}`, { qtyProduced: 150 });
  const reopened = await orderRow();
  check("correcting dyeing down reopens the order's production", reopened.productionStatus === "IN_PRODUCTION" && reopened.status === "IN_PRODUCTION", reopened);
  await floor("PATCH", `/api/production-logs/${d1.id}`, { qtyProduced: 200 });
  check("…and back up finishes it again", (await orderRow()).status === "QC");
  check("order details are locked once production started (409)", (await owner("PATCH", `/api/orders/${orderId}`, { colour: "Red" })).status === 409);

  console.log("\n# QC reversal");
  const readyAlerts = () => db.alertDelivery.count({ where: { templateName: "order_ready", payload: { contains: created.json!.order.orderNo } } });
  const pass = (rollId: string, base: string) => qc<{ qcRecord: { id: string } }>("POST", `/api/rolls/${rollId}/qc`, { result: "PASS", defects: [], baseQcStatus: base });
  const p1 = await pass(r1.id, "PENDING");
  await pass(r2.id, "PENDING");
  check("both rolls passed → READY, one buyer alert queued", (await orderRow()).status === "READY" && (await readyAlerts()) === 1);
  check("an inspected roll can't be deleted (409)", (await floor("DELETE", `/api/rolls/${r1.id}`)).status === 409);
  const reversalPath = `/api/rolls/${r1.id}/qc/${p1.json!.qcRecord.id}/reversal`;
  check("floor can't reverse inspections (403)", (await floor("POST", reversalPath, { reason: "wrong roll" })).status === 403);
  check("a reason is required (400)", (await qc("POST", reversalPath, { reason: "x" })).status === 400);
  check("inspection on another roll → 404", (await qc("POST", `/api/rolls/${r2.id}/qc/${p1.json!.qcRecord.id}/reversal`, { reason: "wrong roll" })).status === 404);
  const rev = await qc<{ qcStatus: string }>("POST", reversalPath, { reason: "Graded the wrong roll" });
  const rolled = await db.roll.findUniqueOrThrow({ where: { id: r1.id } });
  check("reversal puts the roll back to PENDING", rev.status === 201 && rolled.qcStatus === "PENDING", rev.json);
  check("…and the order back to QC", (await orderRow()).status === "QC");
  check("the inspection stays in history, marked reversed", (await db.reversal.count({ where: { qcRecordId: p1.json!.qcRecord.id } })) === 1 && (await db.qCRecord.count({ where: { id: p1.json!.qcRecord.id } })) === 1);
  check("reversing it again → 409", (await qc("POST", reversalPath, { reason: "Graded the wrong roll" })).status === 409);
  const detail = await qc<{ qcRecords: { id: string; reversal: { reversedByName: string; reason: string } | null }[] }>("GET", `/api/rolls/${r1.id}`);
  const shown = detail.json!.qcRecords.find((q) => q.id === p1.json!.qcRecord.id);
  check("roll detail shows who reversed it and why (no user ids)", shown?.reversal?.reversedByName === "qc" && shown.reversal.reason === "Graded the wrong roll" && !JSON.stringify(detail.json).includes((await db.user.findFirstOrThrow({ where: { name: "qc" } })).id), shown);
  await pass(r1.id, "PENDING");
  check("re-inspected → READY again and a second alert queued", (await orderRow()).status === "READY" && (await readyAlerts()) === 2);

  const shipped = await store<{ id: string }>("POST", "/api/dispatches", { buyerId, truckNo: "TN 01 AB 1234", rollIds: [r1.id, r2.id] });
  check("both rolls dispatched → DISPATCHED", shipped.status === 201 && (await orderRow()).status === "DISPATCHED", shipped.json);
  check("a dispatched roll can't be edited (409)", (await floor("PATCH", `/api/rolls/${r1.id}`, { weightKg: 5 })).status === 409);
  const lastQc = await db.qCRecord.findFirstOrThrow({ where: { rollId: r1.id, reversal: { is: null } } });
  check("a dispatched roll's inspection can't be reversed (409)", (await qc("POST", `/api/rolls/${r1.id}/qc/${lastQc.id}/reversal`, { reason: "too late" })).status === 409);
  check("output of a shipped order can't be corrected (409)", (await floor("PATCH", `/api/production-logs/${d1.id}`, { qtyProduced: 190 })).status === 409);
  const truck = await store<{ truckNo: string }>("PATCH", `/api/dispatches/${shipped.json!.id}`, { truckNo: "TN 01 AB 1243" });
  check("mistyped truck number corrected", truck.status === 200 && truck.json!.truckNo === "TN 01 AB 1243", truck.json);
  check("invalid truck number → 400", (await store("PATCH", `/api/dispatches/${shipped.json!.id}`, { truckNo: "!!" })).status === 400);
  check("qc can't edit dispatches (403)", (await qc("PATCH", `/api/dispatches/${shipped.json!.id}`, { truckNo: "TN 1" })).status === 403);
  return { orderId };
}

// ------------------------------------------------------------------- money
async function money(owner: Client, store: Client, orderId: string) {
  console.log("\n# Payments: reverse and correct");
  const invoice = await db.invoice.findFirstOrThrow({ where: { orderId, reversal: { is: null } } });
  const order = () => db.order.findUniqueOrThrow({ where: { id: orderId } });
  const pay = (amount: number) => owner<{ payment: Payment }>("POST", "/api/payments", { invoiceId: invoice.id, amount, mode: "neft", receivedAt: istToday() });

  const p1 = (await pay(1000)).json!.payment;
  check("payment recorded → PARTIAL", (await order()).paymentStatus === "PARTIAL");
  const path = `/api/payments/${p1.id}/reversal`;
  check("storekeeper can't reverse payments (403)", (await store("POST", path, { reason: "typo" })).status === 403);
  check("a reason is required (400)", (await owner("POST", path, { reason: "" })).status === 400);
  const rev = await owner<{ reversal: Reversal }>("POST", path, { reason: "Entered against the wrong invoice" });
  check("payment reversed (201)", rev.status === 201, rev.json);
  const led = await ledgerFor("Payment", p1.id);
  check("ledger: original +1000 and a reversing −1000 pointing at it", led.length === 2 && led[0].amount === 1000 && led[1].amount === -1000 && led[1].reversesId === led[0].id, led);
  check("payment status back to UNPAID", (await order()).paymentStatus === "UNPAID");
  check("the payment row itself is untouched", (await db.payment.findUniqueOrThrow({ where: { id: p1.id } })).amount === 1000);
  check("reversing it again → 409", (await owner("POST", path, { reason: "again" })).status === 409);
  const listed = await owner<{ payments: { id: string; reversal: unknown }[]; totals: { receivedThisMonth: number } }>("GET", "/api/payments");
  check("payments list flags the reversal", !!listed.json!.payments.find((p) => p.id === p1.id)?.reversal);

  const p2 = (await pay(500)).json!.payment;
  const both = await Promise.all([1, 2].map(() => owner("POST", `/api/payments/${p2.id}/reversal`, { reason: "double-entered" })));
  check("two reversals at once: exactly one wins, the other gets 409", both.filter((r) => r.status === 201).length === 1 && both.filter((r) => r.status === 409).length === 1, both.map((r) => r.status));
  check("…and exactly one reversing ledger entry", (await ledgerFor("Payment", p2.id)).filter((e) => e.reversesId).length === 1);

  const p3 = (await pay(800)).json!.payment;
  const tooMuch = await owner("POST", `/api/payments/${p3.id}/reversal`, { reason: "amount typo", correction: { amount: invoice.total + 1, mode: "neft", receivedAt: istToday() } });
  check("a correction above the outstanding balance → 400", tooMuch.status === 400, tooMuch.json);
  check("…and nothing was reversed", (await db.reversal.count({ where: { paymentId: p3.id } })) === 0 && (await ledgerFor("Payment", p3.id)).length === 1);
  const corrected = await owner<{ replacement: Payment }>("POST", `/api/payments/${p3.id}/reversal`, { reason: "amount typo", correction: { amount: 850, mode: "upi", receivedAt: istToday() } });
  check("payment corrected 800 → 850 in one step", corrected.status === 201 && corrected.json!.replacement.amount === 850, corrected.json);
  const rv = await db.reversal.findUniqueOrThrow({ where: { paymentId: p3.id } });
  check("the reversal links its replacement", rv.replacementId === corrected.json!.replacement.id);
  check("replacement has its own ledger entry", (await ledgerFor("Payment", corrected.json!.replacement.id)).length === 1);
  const balance = await owner<{ invoices: { id: string; paid: number; outstanding: number }[] }>("GET", "/api/payments");
  const row = balance.json!.invoices.find((i) => i.id === invoice.id)!;
  check("invoice balance counts only the 850 still standing", Math.abs(row.paid - 850) < 0.01 && Math.abs(row.outstanding - (invoice.total - 850)) < 0.01, row);

  console.log("\n# Invoices: credit note and re-issue");
  const blocked = await owner("POST", `/api/invoices/${invoice.id}/reversal`, { reason: "price typo" });
  check("an invoice with payments can't be cancelled (409, says to reverse them)", blocked.status === 409 && /payment/.test(firstError(blocked.json)), blocked.json);
  await owner("POST", `/api/payments/${corrected.json!.replacement.id}/reversal`, { reason: "will re-enter after the credit note" });
  const priceBefore = (await order()).pricePerMetre;
  const credit = await owner<{ replacement: Invoice }>("POST", `/api/invoices/${invoice.id}/reversal`, { reason: "Price agreed was ₹10/m higher", correction: { pricePerMetre: priceBefore + 10 } });
  check("invoice reversed and re-issued at the corrected price", credit.status === 201 && credit.json!.replacement.subtotal === (await order()).qtyMetres * (priceBefore + 10), credit.json);
  check("the order's price follows the corrected invoice", (await order()).pricePerMetre === priceBefore + 10);
  const revenue = await db.ledgerEntry.aggregate({ where: { orderId, type: "revenue" }, _sum: { amount: true } });
  check("net revenue in the ledger = the new invoice's subtotal", Math.abs((revenue._sum.amount ?? 0) - credit.json!.replacement.subtotal) < 0.01, revenue);
  const dispatch = await db.dispatch.findFirstOrThrow({ where: { rolls: { some: { orderId } } } });
  check("the truck now points at the new invoice", dispatch.invoiceId === credit.json!.replacement.id, dispatch);
  check("paying the cancelled invoice → 400", (await pay(10)).status === 400);
  check("cancelling it again → 409", (await owner("POST", `/api/invoices/${invoice.id}/reversal`, { reason: "again" })).status === 409);

  console.log("\n# Expenses: reverse and correct");
  const exp = await owner<{ expense: { id: string } }>("POST", "/api/expenses", { category: "power", amount: 777, date: istToday(), note: "verify bill" });
  const expPath = `/api/expenses/${exp.json!.expense.id}/reversal`;
  const before = await owner<{ totals: { total: number } }>("GET", "/api/expenses");
  const fix = await owner<{ replacement: { id: string; category: string; amount: number } }>("POST", expPath, {
    reason: "Was the canteen bill, not power",
    correction: { category: "overhead", amount: 700, date: istToday(), note: "canteen" },
  });
  check("expense reversed and re-recorded as overhead ₹700", fix.status === 201 && fix.json!.replacement.category === "overhead" && fix.json!.replacement.amount === 700, fix.json);
  const expLed = await ledgerFor("Expense", exp.json!.expense.id);
  check("ledger: power_cost +777 and its reversal", expLed.length === 2 && expLed[0].type === "power_cost" && expLed[1].amount === -777, expLed);
  check("replacement posts overhead +700", (await ledgerFor("Expense", fix.json!.replacement.id))[0]?.type === "overhead");
  const after = await owner<{ totals: { total: number } }>("GET", "/api/expenses");
  check("month's expense total drops by 77 (reversed bill not counted)", Math.abs(before.json!.totals.total - after.json!.totals.total - 77) < 0.01, { before: before.json!.totals, after: after.json!.totals });
  check("reversing it again → 409", (await owner("POST", expPath, { reason: "again" })).status === 409);
  check("unknown expense → 404", (await owner("POST", "/api/expenses/nope/reversal", { reason: "nope nope" })).status === 404);
}

// -------------------------------------------------------------- attendance
const istDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const monthStart = (month: string) => new Date(`${month}-01T00:00:00+05:30`);
const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

/** Today, or the last day of the latest month whose wages aren't paid out
 * (another suite may already have approved this month's payout). */
async function unlockedDay(): Promise<string> {
  const paidOut = new Set((await db.payoutApproval.findMany({ where: { status: "APPROVED" }, select: { month: true } })).map((p) => p.month));
  let day = istToday();
  while (paidOut.has(day.slice(0, 7))) day = istDay(new Date(monthStart(day.slice(0, 7)).getTime() - 1));
  return day;
}

async function attendance(owner: Client) {
  console.log("\n# Attendance and workers");
  const worker = await owner<{ worker: Named }>("POST", "/api/workers", { name: uniq("Verify Worker"), role: "weaver", dailyWage: 500 });
  const workerId = worker.json!.worker.id;
  const shift = "Night (Shift C)";
  const day = await unlockedDay();
  const mark = await owner("POST", "/api/attendance", { date: day, shift, entries: [{ workerId, status: "present" }] });
  check("worker marked present", mark.status === 201, mark.json);
  const row = await db.attendance.findFirst({ where: { workerId } });
  if (!row) return;
  check("unknown mark → 404", (await owner("DELETE", "/api/attendance/nope")).status === 404);
  check("a mistaken mark is deleted", (await owner("DELETE", `/api/attendance/${row.id}`)).status === 200 && (await db.attendance.count({ where: { workerId } })) === 0);
  check("the delete is audited", (await db.auditLog.count({ where: { entity: "Attendance", entityId: row.id, action: "delete" } })) === 1);

  await owner("POST", "/api/attendance", { date: day, shift, entries: [{ workerId, status: "present" }] });
  const archived = await owner<{ worker: Named }>("PATCH", `/api/workers/${workerId}`, { archived: true });
  check("worker archived", archived.status === 200 && !!archived.json!.worker.archivedAt, archived.json);
  const correct = await owner<{ updated: number }>("POST", "/api/attendance", { date: day, shift, entries: [{ workerId, status: "half_day" }] });
  check("an archived worker's existing mark can still be corrected", correct.status === 201 && correct.json!.updated === 1, correct.json);
  const fresh = await owner("POST", "/api/attendance", { date: day, shift: "Morning (Shift A)", entries: [{ workerId, status: "present" }] });
  check("…but they get no new marks (400)", fresh.status === 400 && /archived/.test(firstError(fresh.json)), fresh.json);
  const del = await owner("DELETE", `/api/workers/${workerId}`);
  check("a worker with marks can't be deleted; told to archive (409)", del.status === 409 && /Archive/.test(firstError(del.json)), del.json);

  // Lock a month by approving its payout (the earliest month with marks whose
  // payout isn't approved yet), then try to change it.
  const months = new Set((await db.attendance.findMany({ select: { date: true } })).map((a) => istDay(a.date).slice(0, 7)));
  const paidOut = new Set((await db.payoutApproval.findMany({ where: { status: "APPROVED" }, select: { month: true } })).map((p) => p.month));
  const month = [...months].sort().find((m) => !paidOut.has(m));
  check("a month with attendance and no approved payout exists", month);
  if (!month) return;
  const pending = await db.payoutApproval.findUnique({ where: { month } });
  const requestId =
    pending?.status === "PENDING" ? pending.id : (await owner<{ request: { id: string } }>("POST", "/api/payout-approvals", { month })).json!.request.id;
  let approved = await owner("PATCH", `/api/payout-approvals/${requestId}`, { status: "APPROVED" });
  // 409: the total was refreshed to the month's current attendance; approve that.
  if (approved.status === 409) approved = await owner("PATCH", `/api/payout-approvals/${requestId}`, { status: "APPROVED" });
  check(`payout for ${month} approved`, approved.status === 200, approved.json);
  const lockedMark = await db.attendance.findFirstOrThrow({ where: { date: { gte: monthStart(month), lt: monthStart(nextMonth(month)) } } });
  const lockedDate = istDay(lockedMark.date);
  check("a mark in a paid-out month can't be deleted (409)", (await owner("DELETE", `/api/attendance/${lockedMark.id}`)).status === 409);
  const relock = await owner("POST", "/api/attendance", { date: lockedDate, shift: lockedMark.shift, entries: [{ workerId: lockedMark.workerId, status: "absent" }] });
  check("…or changed through the muster (409)", relock.status === 409 && /paid out/.test(firstError(relock.json)), relock.json);
  const payoutExpense = await db.expense.findFirstOrThrow({ where: { note: { contains: "Wage payout" } }, orderBy: { date: "desc" } });
  const payoutRev = await owner("POST", `/api/expenses/${payoutExpense.id}/reversal`, { reason: "try to undo the payout" });
  check("the payout's bill can't be reversed (409)", payoutRev.status === 409, payoutRev.json);
}

// ---------------------------------------------------------- hostile input
async function hostileInput(owner: Client) {
  console.log("\n# Hostile input");
  check("1 MB body → 400, not 500", (await owner("POST", "/api/suppliers", { name: "x".repeat(1_000_000), contact: "x" })).status === 400);
  check("array instead of an object → 400", (await owner("PATCH", `/api/buyers/${(await db.buyer.findFirstOrThrow()).id}`, [1, 2])).status === 400);
  check("null body → 400", (await owner("POST", "/api/expenses/x/reversal", "null")).status === 400);
  check("number as a string with spaces → 400", (await owner("POST", "/api/yarn-types", { name: uniq("Y"), count: "1", material: "x", colour: "x", lowStockThresholdKg: " ", costPerKg: 5 })).status === 400);
  check("Infinity price → 400", (await owner("POST", "/api/orders", orderBody((await db.buyer.findFirstOrThrow({ where: { archivedAt: null } })).id, { pricePerMetre: "Infinity" }))).status === 400);
  check("unsupported verb → 405", (await owner("PUT", "/api/buyers", {})).status === 405);
  check("path traversal in an id → 404", [404, 400].includes((await owner("PATCH", "/api/buyers/..%2F..%2Fusers", { contact: "x" })).status));
}

// ------------------------------------------------------------- invariants
async function invariants() {
  console.log("\n# Ledger and reversal invariants (database)");
  for (const r of await ledgerInvariants(db)) check(r.name, r.ok, r.detail);

  // Rolls some suites write straight to the database with a grade and no
  // inspection are left out; a roll whose inspections were all reversed counts.
  const pendingButGraded = await db.roll.findMany({
    where: { dispatchId: null, qcRecords: { some: {} } },
    select: { rollNo: true, qcStatus: true, qcRecords: { where: { reversal: { is: null } }, orderBy: { inspectedAt: "desc" }, take: 1, select: { result: true } } },
  });
  const drift = pendingButGraded.filter((r) => (r.qcRecords[0]?.result ?? "PENDING") !== r.qcStatus);
  check("every undispatched inspected roll's grade = its latest unreversed inspection", drift.length === 0, drift.slice(0, 5));
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
