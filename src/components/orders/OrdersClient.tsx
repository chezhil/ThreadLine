"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Input, Select, Table, Badge, Card, CardHeader, EmptyState, Drawer } from "@/components/ui";
import { useApi, postJson } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";

interface Buyer {
  id: string;
  name: string;
}

interface Order {
  id: string;
  orderNo: string;
  buyer: { name: string };
  fabricType: string;
  colour: string;
  gsm: number;
  qtyMetres: number;
  pricePerMetre: number;
  deadline: string;
  status: string;
}

type FeasibilityResult = {
  status: "FEASIBLE" | "FEASIBLE_IF" | "DEADLINE_NOT_REALISTIC";
  message: string;
} | null;

export function OrdersClient() {
  const orders = useApi<{ orders: Order[] }>("/api/orders");
  const buyers = useApi<{ buyers: Buyer[] }>("/api/buyers");
  const yarnTypes = useApi<{ yarnTypes: { id: string; name: string; colour: string }[] }>(
    "/api/yarn-types",
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useRealtimeEvent(RealtimeEvents.OrderStatus, () => orders.refetch());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Orders</h1>
          <p className="text-sm text-gray-500">Buyer tracking link: share /track/[token] once created.</p>
        </div>
        <Button onClick={() => setDrawerOpen(true)}>New order</Button>
      </div>

      <Table
        columns={[
          {
            header: "Order #",
            render: (o: Order) => (
              <Link href={`/orders/${o.id}`} className="font-medium text-brand hover:underline">
                {o.orderNo}
              </Link>
            ),
          },
          { header: "Buyer", render: (o: Order) => o.buyer.name },
          { header: "Fabric", render: (o: Order) => `${o.fabricType} · ${o.colour} · ${o.gsm}gsm` },
          { header: "Qty (m)", render: (o: Order) => o.qtyMetres },
          { header: "Deadline", render: (o: Order) => new Date(o.deadline).toLocaleDateString() },
          { header: "Status", render: (o: Order) => <Badge status={o.status} /> },
        ]}
        rows={orders.data?.orders ?? []}
        keyFor={(o) => o.id}
        emptyState={<EmptyState title="No orders yet" description="Create the first one." />}
      />

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New order">
        <NewOrderForm
          buyers={buyers.data?.buyers ?? []}
          yarnTypes={yarnTypes.data?.yarnTypes ?? []}
          onCreated={() => {
            orders.refetch();
            setDrawerOpen(false);
          }}
        />
      </Drawer>
    </div>
  );
}

function NewOrderForm({
  buyers,
  yarnTypes,
  onCreated,
}: {
  buyers: Buyer[];
  yarnTypes: { id: string; name: string; colour: string }[];
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    buyerId: "",
    fabricType: "",
    colour: "",
    gsm: "",
    qtyMetres: "",
    pricePerMetre: "",
    deadline: "",
    yarnTypeId: "",
    wastagePct: "8",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [feasibility, setFeasibility] = useState<FeasibilityResult>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleCheckFeasibility() {
    setChecking(true);
    const { ok, data, fieldErrors } = await postJson<FeasibilityResult>("/api/orders/feasibility", {
      fabricType: form.fabricType,
      gsm: Number(form.gsm),
      qtyMetres: Number(form.qtyMetres),
      deadline: form.deadline,
      wastagePct: Number(form.wastagePct),
      yarnTypeId: form.yarnTypeId,
    });
    setChecking(false);
    if (!ok) {
      setErrors(fieldErrors ?? {});
      return;
    }
    setFeasibility(data);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { ok, fieldErrors } = await postJson("/api/orders", {
      buyerId: form.buyerId,
      fabricType: form.fabricType,
      colour: form.colour,
      gsm: Number(form.gsm),
      qtyMetres: Number(form.qtyMetres),
      pricePerMetre: Number(form.pricePerMetre),
      deadline: form.deadline,
    });
    setSubmitting(false);
    if (!ok) {
      setErrors(fieldErrors ?? {});
      return;
    }
    onCreated();
  }

  const badgeStatus =
    feasibility?.status === "FEASIBLE"
      ? "pass"
      : feasibility?.status === "FEASIBLE_IF"
        ? "rework"
        : feasibility
          ? "reject"
          : undefined;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Select label="Buyer" value={form.buyerId} onChange={(e) => setForm({ ...form, buyerId: e.target.value })} options={buyers.map((b) => ({ value: b.id, label: b.name }))} placeholder="Select buyer" error={errors.buyerId?.[0]} required />
      <Input label="Fabric type" value={form.fabricType} onChange={(e) => setForm({ ...form, fabricType: e.target.value })} error={errors.fabricType?.[0]} required />
      <Input label="Colour" value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} error={errors.colour?.[0]} required />
      <Input label="GSM" type="number" value={form.gsm} onChange={(e) => setForm({ ...form, gsm: e.target.value })} error={errors.gsm?.[0]} required />
      <Input label="Quantity (metres)" type="number" value={form.qtyMetres} onChange={(e) => setForm({ ...form, qtyMetres: e.target.value })} error={errors.qtyMetres?.[0]} required />
      <Input label="Price per metre (₹)" type="number" value={form.pricePerMetre} onChange={(e) => setForm({ ...form, pricePerMetre: e.target.value })} error={errors.pricePerMetre?.[0]} required />
      <Input label="Deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} error={errors.deadline?.[0]} required />

      <Card className="bg-gray-50">
        <CardHeader title="Feasibility check" />
        <div className="flex flex-col gap-3">
          <Select label="Yarn type to check against" value={form.yarnTypeId} onChange={(e) => setForm({ ...form, yarnTypeId: e.target.value })} options={yarnTypes.map((yt) => ({ value: yt.id, label: `${yt.name} — ${yt.colour}` }))} placeholder="Select yarn type" error={errors.yarnTypeId?.[0]} />
          <Input label="Wastage %" type="number" value={form.wastagePct} onChange={(e) => setForm({ ...form, wastagePct: e.target.value })} />
          <Button type="button" variant="secondary" onClick={handleCheckFeasibility} disabled={checking}>
            {checking ? "Checking..." : "Check feasibility"}
          </Button>
          {feasibility && (
            <div className="flex items-start gap-2 text-sm">
              {badgeStatus && <Badge status={badgeStatus} />}
              <span>{feasibility.message}</span>
            </div>
          )}
        </div>
      </Card>

      <Button type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create order"}</Button>
    </form>
  );
}
