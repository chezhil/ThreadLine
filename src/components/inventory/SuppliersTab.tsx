"use client";
import { useState } from "react";
import { Badge, Button, ConfirmButton, Drawer, EmptyState, Input, Table } from "@/components/ui";
import { firstError, postJson } from "@/lib/useApi";
import { supplierSchema } from "@/lib/validation/yarn";
import { useZodForm } from "@/components/accounts/useZodForm";
import { ErrorNote } from "@/components/accounts/Stat";
import type { SupplierRow } from "./types";

export function SuppliersTab({ suppliers, onChanged }: { suppliers: SupplierRow[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = suppliers.filter((s) => showArchived || !s.archivedAt);

  async function setArchived(s: SupplierRow, archived: boolean) {
    setError(null);
    const res = await postJson(`/api/suppliers/${s.id}`, { archived }, "PATCH");
    if (!res.ok) setError(firstError(res, `Couldn't ${archived ? "archive" : "restore"} ${s.name}`));
    onChanged();
  }

  async function remove(s: SupplierRow) {
    const res = await postJson(`/api/suppliers/${s.id}`, undefined, "DELETE");
    if (!res.ok) return firstError(res, `Couldn't delete ${s.name}`);
    onChanged();
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived ({suppliers.filter((s) => s.archivedAt).length})
        </label>
        <Button onClick={() => setEditing("new")}>Add supplier</Button>
      </div>
      {error && <ErrorNote message={error} />}
      <Table
        columns={[
          {
            header: "Name",
            render: (s: SupplierRow) => (
              <span className="flex items-center gap-2 font-medium">
                {s.name}
                {s.archivedAt && <Badge status="pending">archived</Badge>}
              </span>
            ),
          },
          { header: "Contact", render: (s) => s.contact },
          { header: "GSTIN", render: (s) => s.gstin ?? "—" },
          { header: "Lots", className: "text-right tabular-nums", render: (s) => s._count.yarnLots },
          {
            header: "",
            render: (s) => (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setArchived(s, !s.archivedAt)}>
                  {s.archivedAt ? "Restore" : "Archive"}
                </Button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Confirm delete"
                  disabled={s._count.yarnLots > 0}
                  title={s._count.yarnLots > 0 ? "Has yarn lots on record — archive it instead" : undefined}
                  onConfirm={() => remove(s)}
                />
              </div>
            ),
          },
        ]}
        rows={rows}
        keyFor={(s) => s.id}
        emptyState={<EmptyState title={suppliers.length ? "No active suppliers" : "No suppliers yet"} description="Add the mills you buy yarn from." />}
      />

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add supplier" : "Edit supplier"}>
        {editing && (
          <SupplierForm
            key={editing === "new" ? "new" : editing.id}
            supplier={editing === "new" ? null : editing}
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

function SupplierForm({ supplier, onSaved }: { supplier: SupplierRow | null; onSaved: () => void }) {
  const form = useZodForm(supplierSchema, {
    name: supplier?.name ?? "",
    contact: supplier?.contact ?? "",
    gstin: supplier?.gstin ?? "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.validate()) return;
    const body = supplier ? form.changed() : form.values;
    if (supplier && Object.keys(body).length === 0) return onSaved();
    form.setSubmitting(true);
    const res = await postJson(supplier ? `/api/suppliers/${supplier.id}` : "/api/suppliers", body, supplier ? "PATCH" : "POST");
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the supplier"] });
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Input label="Name" name="name" autoComplete="off" maxLength={120} {...form.field("name")} />
      <Input label="Contact (phone or email)" name="contact" maxLength={120} {...form.field("contact")} />
      <Input label="GSTIN (optional)" name="gstin" maxLength={15} placeholder="27AASFS1234A1Z5" {...form.field("gstin")} />
      {form.errors._form && <p role="alert" className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
      </Button>
    </form>
  );
}
