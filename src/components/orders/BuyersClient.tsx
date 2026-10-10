"use client";
import { useMemo, useState } from "react";
import { Badge, Button, ConfirmButton, Drawer, EmptyState, Input, Table, Textarea } from "@/components/ui";
import { firstError, postJson, useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import { buyerSchema } from "@/lib/validation/order";
import { useZodForm } from "@/components/accounts/useZodForm";
import { ErrorNote, Loading, PageTitle } from "@/components/accounts/Stat";

interface BuyerRow {
  id: string;
  name: string;
  contact: string;
  gstin: string | null;
  address: string | null;
  archivedAt: string | null;
  _count: { orders: number; dispatches: number };
}

export function BuyersClient() {
  const { data, loading, error, refetch } = useApi<{ buyers: BuyerRow[] }>("/api/buyers");
  const [editing, setEditing] = useState<BuyerRow | "new" | null>(null);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if (change.entity === "Buyer") refetch();
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.buyers ?? []).filter(
      (b) => (showArchived || !b.archivedAt) && (!needle || [b.name, b.contact, b.gstin ?? ""].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [data, q, showArchived]);

  async function setArchived(b: BuyerRow, archived: boolean) {
    setRowError(null);
    const res = await postJson(`/api/buyers/${b.id}`, { archived }, "PATCH");
    if (!res.ok) setRowError(firstError(res, `Couldn't ${archived ? "archive" : "restore"} ${b.name}`));
    refetch();
  }

  async function remove(b: BuyerRow) {
    const res = await postJson(`/api/buyers/${b.id}`, undefined, "DELETE");
    if (!res.ok) return firstError(res, `Couldn't delete ${b.name}`);
    refetch();
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Buyers"
        subtitle="Who the mill sells to. A buyer with orders can't be deleted — archive it to hide it from new orders."
        action={<Button onClick={() => setEditing("new")}>Add buyer</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <Input aria-label="Search buyers" placeholder="Search name, contact or GSTIN" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>
      {rowError && <ErrorNote message={rowError} />}
      {error && <ErrorNote message={`Couldn't load buyers: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}
      {data && (
        <Table
          columns={[
            {
              header: "Name",
              render: (b: BuyerRow) => (
                <span className="flex items-center gap-2 font-medium">
                  {b.name}
                  {b.archivedAt && <Badge status="pending">archived</Badge>}
                </span>
              ),
            },
            { header: "Contact", render: (b) => b.contact },
            { header: "GSTIN", render: (b) => b.gstin ?? "—" },
            { header: "Address", className: "max-w-xs truncate", render: (b) => <span title={b.address ?? ""}>{b.address ?? "—"}</span> },
            { header: "Orders", className: "text-right tabular-nums", render: (b) => b._count.orders },
            {
              header: "",
              render: (b) => {
                const inUse = b._count.orders + b._count.dispatches > 0;
                return (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(b)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setArchived(b, !b.archivedAt)}>
                      {b.archivedAt ? "Restore" : "Archive"}
                    </Button>
                    <ConfirmButton
                      label="Delete"
                      confirmLabel="Confirm delete"
                      disabled={inUse}
                      title={inUse ? "Has orders — archive it instead" : undefined}
                      onConfirm={() => remove(b)}
                    />
                  </div>
                );
              },
            },
          ]}
          rows={rows}
          keyFor={(b) => b.id}
          emptyState={<EmptyState title={data.buyers.length ? "No buyers match" : "No buyers yet"} description="Add a buyer before creating their first order." />}
        />
      )}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add buyer" : "Edit buyer"}>
        {editing && (
          <BuyerForm
            key={editing === "new" ? "new" : editing.id}
            buyer={editing === "new" ? null : editing}
            onSaved={() => {
              setEditing(null);
              refetch();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function BuyerForm({ buyer, onSaved }: { buyer: BuyerRow | null; onSaved: () => void }) {
  const form = useZodForm(buyerSchema, {
    name: buyer?.name ?? "",
    contact: buyer?.contact ?? "",
    gstin: buyer?.gstin ?? "",
    address: buyer?.address ?? "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.validate()) return;
    const body = buyer ? form.changed() : form.values;
    if (buyer && Object.keys(body).length === 0) return onSaved();
    form.setSubmitting(true);
    const res = await postJson(buyer ? `/api/buyers/${buyer.id}` : "/api/buyers", body, buyer ? "PATCH" : "POST");
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the buyer"] });
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Input label="Name" name="name" autoComplete="off" maxLength={120} {...form.field("name")} />
      <Input label="Contact (phone for WhatsApp updates, or email)" name="contact" maxLength={120} {...form.field("contact")} />
      <Input label="GSTIN (optional)" name="gstin" maxLength={15} placeholder="27AASFS1234A1Z5" {...form.field("gstin")} />
      <Textarea label="Address (optional)" name="address" maxLength={300} {...form.field("address")} />
      {buyer && <p className="text-xs text-gray-500">A rename shows on this buyer&apos;s past orders and invoices too.</p>}
      {form.errors._form && <p role="alert" className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : buyer ? "Save changes" : "Add buyer"}
      </Button>
    </form>
  );
}
