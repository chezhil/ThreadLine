"use client";
import { useState } from "react";
import { Button, Input, Select, Table, Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { useApi, postJson } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";

interface YarnLot {
  id: string;
  lotNo: string;
  qtyReceivedKg: number;
  qtyRemainingKg: number;
  receivedAt: string;
  supplier: { name: string };
}

interface YarnType {
  id: string;
  name: string;
  count: string;
  material: string;
  colour: string;
  lowStockThresholdKg: number;
  costPerKg: number;
  lots: YarnLot[];
}

interface Supplier {
  id: string;
  name: string;
  contact: string;
  gstin: string | null;
}

interface LowStockItem {
  yarnTypeId: string;
  name: string;
  colour: string;
  remainingKg: number;
  lowStockThresholdKg: number;
}

type Tab = "stock" | "intake" | "suppliers";

export function InventoryClient() {
  const [tab, setTab] = useState<Tab>("stock");
  const yarnTypes = useApi<{ yarnTypes: YarnType[] }>("/api/yarn-types");
  const suppliers = useApi<{ suppliers: Supplier[] }>("/api/suppliers");
  const lowStock = useApi<{ lowStock: LowStockItem[] }>("/api/yarn/low-stock");

  useRealtimeEvent(RealtimeEvents.StockChanged, () => {
    yarnTypes.refetch();
    lowStock.refetch();
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "stock", label: "Stock" },
    { id: "intake", label: "Yarn intake" },
    { id: "suppliers", label: "Suppliers" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Inventory & Purchase</h1>
        <p className="text-sm text-gray-500">Yarn stock, intake and suppliers.</p>
      </div>

      {lowStock.data && lowStock.data.lowStock.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader title="Low stock" />
          <ul className="flex flex-col gap-1 text-sm text-amber-800">
            {lowStock.data.lowStock.map((item) => (
              <li key={item.yarnTypeId}>
                {item.name} ({item.colour}): {item.remainingKg.toFixed(1)}kg left — threshold{" "}
                {item.lowStockThresholdKg}kg
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${
              tab === t.id ? "border-b-2 border-brand text-brand" : "text-gray-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "stock" && (
        <StockTab
          yarnTypes={yarnTypes.data?.yarnTypes ?? []}
          loading={yarnTypes.loading}
        />
      )}
      {tab === "intake" && (
        <IntakeTab
          yarnTypes={yarnTypes.data?.yarnTypes ?? []}
          suppliers={suppliers.data?.suppliers ?? []}
          onCreated={() => {
            yarnTypes.refetch();
            lowStock.refetch();
          }}
        />
      )}
      {tab === "suppliers" && (
        <SuppliersTab
          suppliers={suppliers.data?.suppliers ?? []}
          onCreated={suppliers.refetch}
        />
      )}
    </div>
  );
}

function StockTab({ yarnTypes, loading }: { yarnTypes: YarnType[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-gray-500">Loading...</p>;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {yarnTypes.length === 0 && (
        <EmptyState title="No yarn types yet" description="Add one from the Yarn intake tab." />
      )}
      {yarnTypes.map((yt) => {
        const remaining = yt.lots.reduce((s, l) => s + l.qtyRemainingKg, 0);
        const low = remaining <= yt.lowStockThresholdKg;
        return (
          <Card key={yt.id}>
            <CardHeader
              title={`${yt.name} — ${yt.colour}`}
              action={<Badge status={low ? "reject" : "pass"}>{low ? "low" : "ok"}</Badge>}
            />
            <dl className="grid grid-cols-2 gap-1 text-sm">
              <dt className="text-gray-500">Count / material</dt>
              <dd>{yt.count} / {yt.material}</dd>
              <dt className="text-gray-500">Remaining</dt>
              <dd className="font-medium">{remaining.toFixed(1)} kg</dd>
              <dt className="text-gray-500">Threshold</dt>
              <dd>{yt.lowStockThresholdKg} kg</dd>
              <dt className="text-gray-500">Cost / kg</dt>
              <dd>₹{yt.costPerKg}</dd>
              <dt className="text-gray-500">Lots</dt>
              <dd>{yt.lots.length}</dd>
            </dl>
          </Card>
        );
      })}
    </div>
  );
}

function IntakeTab({
  yarnTypes,
  suppliers,
  onCreated,
}: {
  yarnTypes: YarnType[];
  suppliers: Supplier[];
  onCreated: () => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <NewYarnTypeForm onCreated={onCreated} />
      <NewYarnLotForm yarnTypes={yarnTypes} suppliers={suppliers} onCreated={onCreated} />
    </div>
  );
}

function NewYarnTypeForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "",
    count: "",
    material: "",
    colour: "",
    lowStockThresholdKg: "",
    costPerKg: "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { ok, fieldErrors } = await postJson("/api/yarn-types", {
      ...form,
      lowStockThresholdKg: Number(form.lowStockThresholdKg),
      costPerKg: Number(form.costPerKg),
    });
    setSubmitting(false);
    if (!ok) {
      setErrors(fieldErrors ?? {});
      return;
    }
    setErrors({});
    setForm({ name: "", count: "", material: "", colour: "", lowStockThresholdKg: "", costPerKg: "" });
    onCreated();
  }

  return (
    <Card>
      <CardHeader title="New yarn type" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name?.[0]} required />
        <Input label="Count" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} error={errors.count?.[0]} required />
        <Input label="Material" value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} error={errors.material?.[0]} required />
        <Input label="Colour" value={form.colour} onChange={(e) => setForm({ ...form, colour: e.target.value })} error={errors.colour?.[0]} required />
        <Input label="Low-stock threshold (kg)" type="number" value={form.lowStockThresholdKg} onChange={(e) => setForm({ ...form, lowStockThresholdKg: e.target.value })} error={errors.lowStockThresholdKg?.[0]} required />
        <Input label="Cost per kg (₹)" type="number" value={form.costPerKg} onChange={(e) => setForm({ ...form, costPerKg: e.target.value })} error={errors.costPerKg?.[0]} required />
        <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Add yarn type"}</Button>
      </form>
    </Card>
  );
}

function NewYarnLotForm({
  yarnTypes,
  suppliers,
  onCreated,
}: {
  yarnTypes: YarnType[];
  suppliers: Supplier[];
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    yarnTypeId: "",
    supplierId: "",
    lotNo: "",
    qtyReceivedKg: "",
    receivedAt: todayIST(),
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { ok, fieldErrors } = await postJson("/api/yarn-lots", {
      ...form,
      qtyReceivedKg: Number(form.qtyReceivedKg),
    });
    setSubmitting(false);
    if (!ok) {
      setErrors(fieldErrors ?? {});
      return;
    }
    setErrors({});
    setForm({ yarnTypeId: "", supplierId: "", lotNo: "", qtyReceivedKg: "", receivedAt: todayIST() });
    onCreated();
  }

  return (
    <Card>
      <CardHeader title="Record yarn intake" />
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Select
          label="Yarn type"
          value={form.yarnTypeId}
          onChange={(e) => setForm({ ...form, yarnTypeId: e.target.value })}
          options={yarnTypes.map((yt) => ({ value: yt.id, label: `${yt.name} — ${yt.colour}` }))}
          placeholder="Select yarn type"
          error={errors.yarnTypeId?.[0]}
          required
        />
        <Select
          label="Supplier"
          value={form.supplierId}
          onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
          options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          placeholder="Select supplier"
          error={errors.supplierId?.[0]}
          required
        />
        <Input label="Lot number" value={form.lotNo} onChange={(e) => setForm({ ...form, lotNo: e.target.value })} error={errors.lotNo?.[0]} required />
        <Input label="Quantity received (kg)" type="number" value={form.qtyReceivedKg} onChange={(e) => setForm({ ...form, qtyReceivedKg: e.target.value })} error={errors.qtyReceivedKg?.[0]} required />
        <Input label="Received date" type="date" value={form.receivedAt} onChange={(e) => setForm({ ...form, receivedAt: e.target.value })} error={errors.receivedAt?.[0]} required />
        <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Record intake"}</Button>
      </form>
    </Card>
  );
}

function SuppliersTab({ suppliers, onCreated }: { suppliers: Supplier[]; onCreated: () => void }) {
  const [form, setForm] = useState({ name: "", contact: "", gstin: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const { ok, fieldErrors } = await postJson("/api/suppliers", form);
    setSubmitting(false);
    if (!ok) {
      setErrors(fieldErrors ?? {});
      return;
    }
    setErrors({});
    setForm({ name: "", contact: "", gstin: "" });
    onCreated();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader title="New supplier" />
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name?.[0]} required />
          <Input label="Contact" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} error={errors.contact?.[0]} required />
          <Input label="GSTIN (optional)" value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value })} error={errors.gstin?.[0]} />
          <Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Add supplier"}</Button>
        </form>
      </Card>
      <Table
        columns={[
          { header: "Name", render: (s: Supplier) => s.name },
          { header: "Contact", render: (s: Supplier) => s.contact },
          { header: "GSTIN", render: (s: Supplier) => s.gstin ?? "—" },
        ]}
        rows={suppliers}
        keyFor={(s) => s.id}
        emptyState={<EmptyState title="No suppliers yet" />}
      />
    </div>
  );
}

/** Today's date in the mill's time zone, as YYYY-MM-DD for a date input. */
function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
