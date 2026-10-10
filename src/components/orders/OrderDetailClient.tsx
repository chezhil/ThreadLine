"use client";
import { useState } from "react";
import { Button, Input, Select, Badge, Card, CardHeader } from "@/components/ui";
import { useApi, postJson } from "@/lib/useApi";
import { ORDER_STATUSES } from "@/lib/tokens";

interface YarnLot {
  id: string;
  qtyRemainingKg: number;
  yarnType: { name: string; colour: string };
}

interface Reservation {
  id: string;
  qtyKg: number;
  yarnLot: { lotNo: string; yarnType: { name: string } };
}

interface OrderDetail {
  id: string;
  orderNo: string;
  trackingToken: string;
  status: string;
  buyer: { name: string };
  fabricType: string;
  colour: string;
  gsm: number;
  qtyMetres: number;
  pricePerMetre: number;
  deadline: string;
  reservations: Reservation[];
  invoices: { id: string; invoiceNo: string; total: string | number }[];
}

export function OrderDetailClient({ orderId }: { orderId: string }) {
  const order = useApi<{ order: OrderDetail }>(`/api/orders/${orderId}`);
  const yarnLots = useApi<{ yarnLots: YarnLot[] }>("/api/yarn-lots");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [reserveForm, setReserveForm] = useState({ yarnLotId: "", qtyKg: "" });
  const [reserveErrors, setReserveErrors] = useState<Record<string, string[]>>({});
  const [invoiceCreating, setInvoiceCreating] = useState(false);

  if (order.loading) return <p className="text-sm text-gray-500">Loading...</p>;
  if (!order.data) return <p className="text-sm text-red-600">Order not found.</p>;

  const o = order.data.order;
  const currentIdx = ORDER_STATUSES.indexOf(o.status as (typeof ORDER_STATUSES)[number]);
  const nextStatus = ORDER_STATUSES[currentIdx + 1];
  const trackingUrl = typeof window !== "undefined" ? `${window.location.origin}/track/${o.trackingToken}` : "";

  async function advanceStatus() {
    if (!nextStatus) return;
    setStatusError(null);
    const { ok, fieldErrors } = await postJson(`/api/orders/${orderId}`, { status: nextStatus }, "PATCH");
    if (!ok) {
      setStatusError(Object.values(fieldErrors ?? {})[0]?.[0] ?? "Could not update status");
      return;
    }
    order.refetch();
  }

  async function handleReserve(e: React.FormEvent) {
    e.preventDefault();
    const { ok, fieldErrors } = await postJson(`/api/orders/${orderId}/reserve-yarn`, {
      yarnLotId: reserveForm.yarnLotId,
      qtyKg: Number(reserveForm.qtyKg),
    });
    if (!ok) {
      setReserveErrors(fieldErrors ?? {});
      return;
    }
    setReserveErrors({});
    setReserveForm({ yarnLotId: "", qtyKg: "" });
    order.refetch();
    yarnLots.refetch();
  }

  async function handleGenerateInvoice() {
    setInvoiceCreating(true);
    await postJson("/api/invoices", { orderId });
    setInvoiceCreating(false);
    order.refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{o.orderNo}</h1>
          <p className="text-sm text-gray-500">{o.buyer.name}</p>
        </div>
        <Badge status={o.status} />
      </div>

      <Card>
        <CardHeader title="Order details" />
        <dl className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <dt className="text-gray-500">Fabric</dt>
          <dd>{o.fabricType} / {o.colour} / {o.gsm}gsm</dd>
          <dt className="text-gray-500">Quantity</dt>
          <dd>{o.qtyMetres} m</dd>
          <dt className="text-gray-500">Price/metre</dt>
          <dd>₹{o.pricePerMetre}</dd>
          <dt className="text-gray-500">Deadline</dt>
          <dd>{new Date(o.deadline).toLocaleDateString()}</dd>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Buyer tracking link (no login required)" />
        <p className="break-all text-sm text-brand">{trackingUrl}</p>
      </Card>

      <Card>
        <CardHeader title="Status" />
        <div className="flex items-center gap-3">
          {nextStatus ? (
            <Button onClick={advanceStatus}>Advance to {nextStatus.replace(/_/g, " ")}</Button>
          ) : (
            <p className="text-sm text-gray-500">Order is in its final status.</p>
          )}
          {statusError && <p className="text-sm text-red-600">{statusError}</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Yarn reservations" />
        <ul className="mb-3 flex flex-col gap-1 text-sm">
          {o.reservations.length === 0 && <li className="text-gray-500">No yarn reserved yet.</li>}
          {o.reservations.map((r) => (
            <li key={r.id}>
              {r.qtyKg}kg from lot {r.yarnLot.lotNo} ({r.yarnLot.yarnType.name})
            </li>
          ))}
        </ul>
        <form onSubmit={handleReserve} className="flex flex-wrap items-end gap-3">
          <Select
            label="Yarn lot"
            value={reserveForm.yarnLotId}
            onChange={(e) => setReserveForm({ ...reserveForm, yarnLotId: e.target.value })}
            options={(yarnLots.data?.yarnLots ?? []).map((l) => ({
              value: l.id,
              label: `${l.yarnType.name} (${l.yarnType.colour}) — ${l.qtyRemainingKg}kg left`,
            }))}
            placeholder="Select lot"
            error={reserveErrors.yarnLotId?.[0]}
          />
          <Input
            label="Qty (kg)"
            type="number"
            value={reserveForm.qtyKg}
            onChange={(e) => setReserveForm({ ...reserveForm, qtyKg: e.target.value })}
            error={reserveErrors.qtyKg?.[0]}
          />
          <Button type="submit" variant="secondary">Reserve</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Invoice" />
        {o.invoices.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {o.invoices.map((inv) => (
              <li key={inv.id}>
                {inv.invoiceNo} — ₹{inv.total}
              </li>
            ))}
          </ul>
        ) : (
          <Button variant="secondary" onClick={handleGenerateInvoice} disabled={invoiceCreating}>
            {invoiceCreating ? "Generating..." : "Generate GST invoice"}
          </Button>
        )}
      </Card>
    </div>
  );
}
