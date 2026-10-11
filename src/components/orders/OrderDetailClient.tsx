"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Input, Select, Badge, Card, CardHeader, ConfirmButton, Drawer } from "@/components/ui";
import { useApi, postJson, firstError } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import { dateIN, dateTimeIN, inr } from "@/lib/accounts/format";
import { ErrorNote, Loading } from "@/components/accounts/Stat";
import { OrderForm, type PickBuyer, type PickYarnType } from "./OrderForm";
import dynamic from "next/dynamic";
import type { DispatchWhatsAppPayload } from "@/lib/alerts/whatsapp-format";

// The preview/send sheet only matters once opened; keep it out of the page's first load.
const WhatsAppPreviewModal = dynamic(() => import("@/components/dispatch/WhatsAppPreviewModal").then((m) => m.WhatsAppPreviewModal), { ssr: false });

interface YarnLot {
  id: string;
  lotNo: string;
  qtyRemainingKg: number;
  yarnType: { name: string; colour: string };
}

interface Reservation {
  id: string;
  qtyKg: number;
  yarnLot: { lotNo: string; yarnType: { name: string } };
}

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  total: number;
  createdAt: string;
  reversal: { reason: string; createdAt: string; replacementId: string | null } | null;
}

interface OrderDetail {
  id: string;
  orderNo: string;
  trackingToken: string;
  status: string;
  productionStatus: string;
  qcStatus: string;
  dispatchStatus: string;
  paymentStatus: string;
  buyerId: string;
  buyer: { name: string; contact?: string };
  fabricType: string;
  colour: string;
  gsm: number;
  qtyMetres: number;
  pricePerMetre: number;
  deadline: string;
  feasibilityResult: string | null;
  reservations: Reservation[];
  invoices: InvoiceRow[];
}

const EDITABLE = ["NEW", "CONFIRMED"];
const ORDER_ENTITIES = new Set(["Order", "Invoice", "Payment", "OrderYarnReservation"]);

/** The stored verdict: JSON this app writes, or plain text on older rows. */
function feasibilityText(raw: string | null): { message: string; checkedAt: string | null } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { message?: string; checkedAt?: string };
    return { message: parsed.message ?? raw, checkedAt: parsed.checkedAt ?? null };
  } catch {
    return { message: raw, checkedAt: null };
  }
}

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const router = useRouter();
  const order = useApi<{ order: OrderDetail }>(`/api/orders/${orderId}`);
  const yarnLots = useApi<{ yarnLots: YarnLot[] }>("/api/yarn-lots");
  const [editing, setEditing] = useState(false);
  const [whatsAppModalOpen, setWhatsAppModalOpen] = useState(false);
  const [whatsApp, setWhatsApp] = useState<{ payload: DispatchWhatsAppPayload; target: { orderId: string } } | null>(null);
  const [whatsAppError, setWhatsAppError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [reserveForm, setReserveForm] = useState({ yarnLotId: "", qtyKg: "" });
  const [reserveErrors, setReserveErrors] = useState<Record<string, string[]>>({});
  const [reserving, setReserving] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceCreating, setInvoiceCreating] = useState(false);

  useRealtimeEvent<{ orderId: string }>(RealtimeEvents.OrderStatus, (e) => {
    if (e.orderId === orderId) order.refetch();
  });
  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if (ORDER_ENTITIES.has(change.entity)) order.refetch();
  });

  if (order.loading && !order.data) return <Loading />;
  if (!order.data) {
    return order.status === 404 ? (
      <ErrorNote message="This order doesn't exist (it may have been deleted)." />
    ) : (
      <ErrorNote message={`Couldn't load the order: ${order.error ?? "unknown error"}`} onRetry={order.refetch} />
    );
  }

  const o = order.data.order;
  // The message is built by the server from the order's latest shipment.
  const openWhatsApp = async () => {
    setWhatsAppError(null);
    try {
      const res = await fetch("/api/alerts/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: o.id, preview: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setWhatsAppError(data.error ?? "Couldn't prepare the WhatsApp message.");
        return;
      }
      setWhatsApp({ payload: data.payload, target: { orderId: o.id } });
      setWhatsAppModalOpen(true);
    } catch {
      setWhatsAppError("Couldn't reach the server.");
    }
  };
  const trackingUrl = typeof window !== "undefined" ? `${window.location.origin}/track/${o.trackingToken}` : "";
  const editable = EDITABLE.includes(o.status);
  const activeInvoice = o.invoices.find((i) => !i.reversal);
  const feasibility = feasibilityText(o.feasibilityResult);
  const canReserve = o.status !== "CLOSED" && (editable || o.productionStatus === "IN_PRODUCTION");
  const canRelease = o.productionStatus === "NOT_STARTED" && o.status !== "CLOSED";

  // Only these two are a person's decision; everything else in ORDER_STATUSES
  // is computed from real production/QC/dispatch events (src/lib/order-status.ts)
  // and shown below as read-only badges instead of an "Advance" button.
  const manualAction = o.status === "NEW" ? "CONFIRMED" : o.status === "DISPATCHED" ? "CLOSED" : null;

  async function advanceStatus() {
    if (!manualAction) return;
    setStatusError(null);
    setStatusBusy(true);
    const res = await postJson(`/api/orders/${orderId}`, { status: manualAction }, "PATCH");
    setStatusBusy(false);
    if (!res.ok) {
      setStatusError(firstError(res, "Could not update status"));
      return;
    }
    order.refetch();
  }

  async function handleReserve(e: React.FormEvent) {
    e.preventDefault();
    setReserving(true);
    const res = await postJson(`/api/orders/${orderId}/reserve-yarn`, { yarnLotId: reserveForm.yarnLotId, qtyKg: Number(reserveForm.qtyKg) });
    setReserving(false);
    if (!res.ok) {
      setReserveErrors(res.fieldErrors ?? { _form: ["Couldn't reserve the yarn"] });
      return;
    }
    setReserveErrors({});
    setReserveForm({ yarnLotId: "", qtyKg: "" });
    order.refetch();
    yarnLots.refetch();
  }

  async function release(r: Reservation) {
    const res = await postJson(`/api/orders/${orderId}/reservations/${r.id}`, undefined, "DELETE");
    if (!res.ok) return firstError(res, "Couldn't release the reservation");
    order.refetch();
    yarnLots.refetch();
    return null;
  }

  async function handleGenerateInvoice() {
    setInvoiceError(null);
    setInvoiceCreating(true);
    const res = await postJson("/api/invoices", { orderId });
    setInvoiceCreating(false);
    if (!res.ok) setInvoiceError(firstError(res, "Couldn't raise the invoice"));
    order.refetch();
  }

  async function removeOrder() {
    const res = await postJson(`/api/orders/${orderId}`, undefined, "DELETE");
    if (!res.ok) return firstError(res, "Couldn't delete the order");
    router.push("/orders");
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{o.orderNo}</h1>
          <p className="text-sm text-gray-500">{o.buyer.name}</p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Badge status={o.status} />
          {editable && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Edit details
              </Button>
              <ConfirmButton label="Delete order" confirmLabel="Confirm delete" onConfirm={removeOrder} />
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader title="Order details" />
        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <dt className="text-gray-500">Fabric</dt>
          <dd>
            {o.fabricType} / {o.colour} / {o.gsm}gsm
          </dd>
          <dt className="text-gray-500">Quantity</dt>
          <dd>{o.qtyMetres} m</dd>
          <dt className="text-gray-500">Price/metre</dt>
          <dd>{inr(o.pricePerMetre, { decimals: true })}</dd>
          <dt className="text-gray-500">Deadline</dt>
          <dd>{dateIN(o.deadline)}</dd>
        </dl>
        {feasibility && (
          <p className="mt-3 text-sm text-gray-600">
            <span className="font-medium text-foreground">Feasibility: </span>
            {feasibility.message}
            {feasibility.checkedAt && <span className="text-xs text-gray-500"> (checked {dateTimeIN(feasibility.checkedAt)})</span>}
          </p>
        )}
        {!editable && <p className="mt-3 text-xs text-gray-500">Details are fixed once production starts.</p>}
      </Card>

      <Card>
        <CardHeader
          title="Buyer tracking link (no login required)"
          action={
            <Button
              size="sm"
              variant="secondary"
              onClick={openWhatsApp}
              disabled={o.dispatchStatus === "NOT_DISPATCHED"}
              title={o.dispatchStatus === "NOT_DISPATCHED" ? "Nothing has shipped for this order yet" : undefined}
              className="text-emerald-700 hover:text-emerald-800"
            >
              Preview WhatsApp Alert
            </Button>
          }
        />
        <p className="break-all text-sm text-brand">{trackingUrl}</p>
        {whatsAppError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {whatsAppError}
          </p>
        )}
      </Card>

      <Card>
        <CardHeader title="Status" />
        <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
          <dt className="text-gray-500">Production</dt>
          <dd>
            <Badge status={o.productionStatus} />
          </dd>
          <dt className="text-gray-500">Quality</dt>
          <dd>
            <Badge status={o.qcStatus} />
          </dd>
          <dt className="text-gray-500">Dispatch</dt>
          <dd>
            <Badge status={o.dispatchStatus} />
          </dd>
          <dt className="text-gray-500">Payment</dt>
          <dd>
            <Badge status={o.paymentStatus} />
          </dd>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          {manualAction ? (
            <Button onClick={advanceStatus} disabled={statusBusy}>
              {statusBusy ? "Saving…" : manualAction === "CONFIRMED" ? "Confirm order" : "Close order"}
            </Button>
          ) : (
            <p className="text-sm text-gray-500">Updates automatically as production, QC and dispatch happen — see the badges above.</p>
          )}
          {statusError && (
            <p role="alert" className="text-sm text-red-600">
              {statusError}
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Yarn reservations" />
        <ul className="mb-3 flex flex-col gap-2 text-sm">
          {o.reservations.length === 0 && <li className="text-gray-500">No yarn reserved yet.</li>}
          {o.reservations.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {r.qtyKg} kg from lot {r.yarnLot.lotNo} ({r.yarnLot.yarnType.name})
              </span>
              {canRelease && <ConfirmButton label="Release" confirmLabel="Release yarn" onConfirm={() => release(r)} />}
            </li>
          ))}
        </ul>
        {canReserve && (
          <form onSubmit={handleReserve} className="flex flex-wrap items-end gap-3" noValidate>
            <Select
              label="Yarn lot"
              name="yarnLotId"
              value={reserveForm.yarnLotId}
              onChange={(e) => setReserveForm({ ...reserveForm, yarnLotId: e.target.value })}
              options={(yarnLots.data?.yarnLots ?? [])
                .filter((l) => l.qtyRemainingKg > 0)
                .map((l) => ({ value: l.id, label: `${l.lotNo} · ${l.yarnType.name} (${l.yarnType.colour}) — ${l.qtyRemainingKg.toFixed(1)} kg left` }))}
              placeholder="Select lot"
              error={reserveErrors.yarnLotId?.[0]}
            />
            <Input
              label="Qty (kg)"
              name="qtyKg"
              type="number"
              min="0"
              step="any"
              value={reserveForm.qtyKg}
              onChange={(e) => setReserveForm({ ...reserveForm, qtyKg: e.target.value })}
              error={reserveErrors.qtyKg?.[0]}
            />
            <Button type="submit" variant="secondary" disabled={reserving}>
              {reserving ? "Reserving…" : "Reserve"}
            </Button>
          </form>
        )}
        {reserveErrors._form && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {reserveErrors._form[0]}
          </p>
        )}
        {yarnLots.error && <p className="mt-2 text-sm text-red-600">Couldn&apos;t load yarn lots: {yarnLots.error}</p>}
        {!canRelease && o.reservations.length > 0 && <p className="mt-2 text-xs text-gray-500">Reserved yarn can be released only before production starts.</p>}
      </Card>

      <Card>
        <CardHeader title="Invoice" action={<Link href="/accounts/payments" className="text-xs font-medium text-brand hover:underline">Payments & corrections →</Link>} />
        <ul className="flex flex-col gap-2 text-sm">
          {o.invoices.map((inv) => (
            <li key={inv.id} className={inv.reversal ? "text-gray-500" : ""}>
              <span className={inv.reversal ? "line-through" : "font-medium"}>{inv.invoiceNo}</span> — {inr(inv.total, { decimals: true })} · {dateIN(inv.createdAt)}
              {inv.reversal && (
                <span className="block text-xs">
                  Cancelled {dateIN(inv.reversal.createdAt)}: {inv.reversal.reason}
                </span>
              )}
            </li>
          ))}
        </ul>
        {!activeInvoice && o.status !== "NEW" && (
          <Button className="mt-3" variant="secondary" onClick={handleGenerateInvoice} disabled={invoiceCreating}>
            {invoiceCreating ? "Generating…" : "Generate GST invoice"}
          </Button>
        )}
        {!activeInvoice && o.status === "NEW" && <p className="text-sm text-gray-500">Confirm the order before invoicing it.</p>}
        {invoiceError && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {invoiceError}
          </p>
        )}
      </Card>

      <Drawer open={editing} onClose={() => setEditing(false)} title={`Edit ${o.orderNo}`}>
        {editing && <EditOrder order={o} onSaved={() => { setEditing(false); order.refetch(); }} />}
      </Drawer>

      {whatsAppModalOpen && (
        <WhatsAppPreviewModal
          isOpen={whatsAppModalOpen}
          onClose={() => setWhatsAppModalOpen(false)}
          payload={whatsApp?.payload ?? null}
          target={whatsApp?.target ?? null}
        />
      )}
    </div>
  );
}

function EditOrder({ order, onSaved }: { order: OrderDetail; onSaved: () => void }) {
  const buyers = useApi<{ buyers: PickBuyer[] }>("/api/buyers");
  const yarnTypes = useApi<{ yarnTypes: PickYarnType[] }>("/api/yarn-types");
  if (buyers.error || yarnTypes.error) {
    return <ErrorNote message={`Couldn't load buyers or yarn types: ${buyers.error ?? yarnTypes.error}`} onRetry={() => { buyers.refetch(); yarnTypes.refetch(); }} />;
  }
  if (!buyers.data || !yarnTypes.data) return <Loading />;
  return <OrderForm order={order} buyers={buyers.data.buyers} yarnTypes={yarnTypes.data.yarnTypes} onSaved={onSaved} />;
}
