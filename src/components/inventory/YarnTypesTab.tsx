"use client";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, ConfirmButton, Drawer, EmptyState, Input } from "@/components/ui";
import { firstError, postJson } from "@/lib/useApi";
import { yarnTypeSchema } from "@/lib/validation/yarn";
import { useZodForm } from "@/components/accounts/useZodForm";
import { ErrorNote } from "@/components/accounts/Stat";
import type { YarnTypeRow } from "./types";

export function YarnTypesTab({ yarnTypes, onChanged }: { yarnTypes: YarnTypeRow[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<YarnTypeRow | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = yarnTypes.filter((t) => showArchived || !t.archivedAt);
  const archivedCount = yarnTypes.length - yarnTypes.filter((t) => !t.archivedAt).length;

  async function setArchived(t: YarnTypeRow, archived: boolean) {
    setError(null);
    const res = await postJson(`/api/yarn-types/${t.id}`, { archived }, "PATCH");
    if (!res.ok) setError(firstError(res, `Couldn't ${archived ? "archive" : "restore"} ${t.name}`));
    onChanged();
  }

  async function remove(t: YarnTypeRow) {
    const res = await postJson(`/api/yarn-types/${t.id}`, undefined, "DELETE");
    if (!res.ok) return firstError(res, `Couldn't delete ${t.name}`);
    onChanged();
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show archived ({archivedCount})
        </label>
        <Button onClick={() => setEditing("new")}>Add yarn type</Button>
      </div>
      {error && <ErrorNote message={error} />}
      {visible.length === 0 ? (
        <EmptyState title={yarnTypes.length ? "No active yarn types" : "No yarn types yet"} description="Add the yarns the mill stocks." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((yt) => {
            const remaining = yt.lots.reduce((s, l) => s + l.qtyRemainingKg, 0);
            const low = remaining <= yt.lowStockThresholdKg;
            const inUse = yt._count.lots + yt._count.purchaseRequests > 0;
            return (
              <Card key={yt.id} className={yt.archivedAt ? "opacity-70" : ""}>
                <CardHeader
                  title={`${yt.name} — ${yt.colour}`}
                  action={yt.archivedAt ? <Badge status="pending">archived</Badge> : <Badge status={low ? "reject" : "pass"}>{low ? "low" : "ok"}</Badge>}
                />
                <dl className="grid grid-cols-2 gap-1 text-sm">
                  <dt className="text-gray-500">Count / material</dt>
                  <dd>
                    {yt.count} / {yt.material}
                  </dd>
                  <dt className="text-gray-500">Remaining</dt>
                  <dd className="font-medium">{remaining.toFixed(1)} kg</dd>
                  <dt className="text-gray-500">Threshold</dt>
                  <dd>{yt.lowStockThresholdKg} kg</dd>
                  <dt className="text-gray-500">Cost / kg</dt>
                  <dd>₹{yt.costPerKg}</dd>
                  <dt className="text-gray-500">Lots</dt>
                  <dd>{yt._count.lots}</dd>
                </dl>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(yt)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setArchived(yt, !yt.archivedAt)}>
                    {yt.archivedAt ? "Restore" : "Archive"}
                  </Button>
                  <ConfirmButton
                    label="Delete"
                    confirmLabel="Confirm delete"
                    disabled={inUse}
                    title={inUse ? "Has lots or purchase requests — archive it instead" : undefined}
                    onConfirm={() => remove(yt)}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add yarn type" : "Edit yarn type"}>
        {editing && (
          <YarnTypeForm
            key={editing === "new" ? "new" : editing.id}
            yarnType={editing === "new" ? null : editing}
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

function YarnTypeForm({ yarnType, onSaved }: { yarnType: YarnTypeRow | null; onSaved: () => void }) {
  const form = useZodForm(yarnTypeSchema, {
    name: yarnType?.name ?? "",
    count: yarnType?.count ?? "",
    material: yarnType?.material ?? "",
    colour: yarnType?.colour ?? "",
    lowStockThresholdKg: yarnType ? String(yarnType.lowStockThresholdKg) : "",
    costPerKg: yarnType ? String(yarnType.costPerKg) : "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.validate()) return;
    const body = yarnType ? form.changed() : form.values;
    if (yarnType && Object.keys(body).length === 0) return onSaved();
    form.setSubmitting(true);
    const res = await postJson(yarnType ? `/api/yarn-types/${yarnType.id}` : "/api/yarn-types", body, yarnType ? "PATCH" : "POST");
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the yarn type"] });
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Input label="Name" name="name" autoComplete="off" maxLength={80} {...form.field("name")} />
      <Input label="Count" name="count" maxLength={20} placeholder="e.g. 30s" {...form.field("count")} />
      <Input label="Material" name="material" maxLength={60} {...form.field("material")} />
      <Input label="Colour" name="colour" maxLength={60} {...form.field("colour")} />
      <Input label="Low-stock threshold (kg)" name="lowStockThresholdKg" type="number" min="0" step="any" inputMode="decimal" {...form.field("lowStockThresholdKg")} />
      <Input label="Cost per kg (₹)" name="costPerKg" type="number" min="0" step="0.01" inputMode="decimal" {...form.field("costPerKg")} />
      {yarnType && (
        <p className="text-xs text-gray-500">
          Costing charges every roll made from this yarn at its cost per kg, past rolls included — change it to correct a mistake, not for a new price.
        </p>
      )}
      {form.errors._form && <p role="alert" className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : yarnType ? "Save changes" : "Add yarn type"}
      </Button>
    </form>
  );
}
