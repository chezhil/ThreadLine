"use client";
import { useMemo, useState } from "react";
import { Button, ConfirmButton, Drawer, EmptyState, Input, Select, Table } from "@/components/ui";
import { firstError, postJson } from "@/lib/useApi";
import { dateIN, todayIST } from "@/lib/accounts/format";
import { yarnLotSchema } from "@/lib/validation/yarn";
import { useZodForm } from "@/components/accounts/useZodForm";
import { yarnLabel, type SupplierRow, type YarnLotRow, type YarnTypeRow } from "./types";

export function YarnLotsTab({
  lots,
  yarnTypes,
  suppliers,
  onChanged,
}: {
  lots: YarnLotRow[];
  yarnTypes: YarnTypeRow[];
  suppliers: SupplierRow[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<YarnLotRow | "new" | null>(null);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lots.filter((l) => !needle || [l.lotNo, l.yarnType.name, l.supplier.name].some((s) => s.toLowerCase().includes(needle)));
  }, [lots, q]);

  async function remove(lot: YarnLotRow) {
    const res = await postJson(`/api/yarn-lots/${lot.id}`, undefined, "DELETE");
    if (!res.ok) return firstError(res, `Couldn't delete lot ${lot.lotNo}`);
    onChanged();
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input aria-label="Search lots" placeholder="Search lot, yarn or supplier" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={() => setEditing("new")}>Record intake</Button>
      </div>
      <Table
        columns={[
          { header: "Lot", render: (l: YarnLotRow) => <span className="font-medium">{l.lotNo}</span> },
          { header: "Yarn", render: (l) => yarnLabel(l.yarnType) },
          { header: "Supplier", render: (l) => l.supplier.name },
          { header: "Received on", render: (l) => dateIN(l.receivedAt) },
          { header: "Received", className: "text-right tabular-nums", render: (l) => `${l.qtyReceivedKg} kg` },
          { header: "Remaining", className: "text-right tabular-nums", render: (l) => `${l.qtyRemainingKg.toFixed(1)} kg` },
          { header: "For order", render: (l) => l.linkedOrderNo ?? <span className="text-gray-400">—</span> },
          {
            header: "",
            render: (l) => {
              const used = l._count.reservations + l._count.rolls > 0;
              return (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(l)}>
                    Edit
                  </Button>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Confirm delete"
                    disabled={used}
                    title={used ? "Reserved or made into rolls — correct it instead" : undefined}
                    onConfirm={() => remove(l)}
                  />
                </div>
              );
            },
          },
        ]}
        rows={rows}
        keyFor={(l) => l.id}
        emptyState={<EmptyState title={lots.length ? "No lots match" : "No yarn received yet"} description="Record each delivery as a lot." />}
      />

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Record yarn intake" : `Correct lot ${editing?.lotNo ?? ""}`}>
        {editing && (
          <YarnLotForm
            key={editing === "new" ? "new" : editing.id}
            lot={editing === "new" ? null : editing}
            yarnTypes={yarnTypes}
            suppliers={suppliers}
            onSaved={() => {
              setEditing(null);
              onChanged();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function YarnLotForm({
  lot,
  yarnTypes,
  suppliers,
  onSaved,
}: {
  lot: YarnLotRow | null;
  yarnTypes: YarnTypeRow[];
  suppliers: SupplierRow[];
  onSaved: () => void;
}) {
  const form = useZodForm(yarnLotSchema, {
    yarnTypeId: lot?.yarnTypeId ?? "",
    supplierId: lot?.supplierId ?? "",
    lotNo: lot?.lotNo ?? "",
    qtyReceivedKg: lot ? String(lot.qtyReceivedKg) : "",
    receivedAt: lot ? new Date(lot.receivedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : todayIST(),
  });
  const used = !!lot && lot._count.reservations + lot._count.rolls > 0;
  // Archived records stay selectable only where this lot already uses them.
  const typeOptions = yarnTypes.filter((t) => !t.archivedAt || t.id === lot?.yarnTypeId).map((t) => ({ value: t.id, label: yarnLabel(t) }));
  const supplierOptions = suppliers.filter((s) => !s.archivedAt || s.id === lot?.supplierId).map((s) => ({ value: s.id, label: s.name }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.validate()) return;
    const body = lot ? form.changed() : form.values;
    if (lot && Object.keys(body).length === 0) return onSaved();
    form.setSubmitting(true);
    const res = await postJson(lot ? `/api/yarn-lots/${lot.id}` : "/api/yarn-lots", body, lot ? "PATCH" : "POST");
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the lot"] });
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Select label="Yarn type" name="yarnTypeId" placeholder="Select yarn type" options={typeOptions} disabled={used} {...form.field("yarnTypeId")} />
      {used && <p className="text-xs text-gray-500">This lot is reserved or made into rolls, so its yarn type stays.</p>}
      <Select label="Supplier" name="supplierId" placeholder="Select supplier" options={supplierOptions} {...form.field("supplierId")} />
      <Input label="Lot number" name="lotNo" autoComplete="off" maxLength={40} {...form.field("lotNo")} />
      <Input label="Quantity received (kg)" name="qtyReceivedKg" type="number" min="0" step="any" inputMode="decimal" {...form.field("qtyReceivedKg")} />
      {lot && lot.qtyReceivedKg !== lot.qtyRemainingKg && (
        <p className="text-xs text-gray-500">
          {(lot.qtyReceivedKg - lot.qtyRemainingKg).toFixed(1)} kg is reserved; remaining stock moves by the same amount as the received quantity.
        </p>
      )}
      <Input label="Received date" name="receivedAt" type="date" max={todayIST()} {...form.field("receivedAt")} />
      {form.errors._form && <p role="alert" className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : lot ? "Save changes" : "Record intake"}
      </Button>
    </form>
  );
}
