"use client";
import { useMemo, useState } from "react";
import { Button, Drawer, EmptyState, Input, Select, Table } from "@/components/ui";
import { postJson, useApi } from "@/lib/useApi";
import { inr } from "@/lib/accounts/format";
import { WORKER_ROLES, workerSchema } from "@/lib/validation/accounts";
import { ErrorNote, Loading, PageTitle } from "./Stat";
import { useZodForm } from "./useZodForm";

interface WorkerRow {
  id: string;
  name: string;
  role: string;
  dailyWage: number;
  _count: { attendance: number };
}

export const roleLabel = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function WorkersClient() {
  const { data, loading, error, refetch } = useApi<{ workers: WorkerRow[] }>("/api/workers");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [editing, setEditing] = useState<WorkerRow | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.workers ?? []).filter((w) => (!role || w.role === role) && (!needle || w.name.toLowerCase().includes(needle)));
  }, [data, q, role]);

  async function remove(w: WorkerRow) {
    setRowError(null);
    const res = await fetch(`/api/workers/${w.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setConfirmDelete(null);
    if (!res.ok) {
      setRowError(body?.fieldErrors?._form?.[0] ?? body?.error ?? "Couldn't delete the worker");
      return;
    }
    refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Workers" subtitle="Daily wage per worker. Wages are earned from attendance: full day, half day or absent." action={<Button onClick={() => setEditing("new")}>Add worker</Button>} />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input aria-label="Search workers" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          aria-label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          options={[{ value: "", label: "All roles" }, ...WORKER_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))]}
        />
      </div>

      {rowError && <ErrorNote message={rowError} />}
      {error && <ErrorNote message={`Couldn't load workers: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}
      {data && (
        <Table
          columns={[
            { header: "Name", render: (w: WorkerRow) => <span className="font-medium">{w.name}</span> },
            { header: "Role", render: (w) => roleLabel(w.role) },
            { header: "Daily wage", className: "text-right tabular-nums", render: (w) => inr(w.dailyWage) },
            { header: "Attendance marks", className: "text-right tabular-nums", render: (w) => w._count.attendance },
            {
              header: "",
              render: (w) => (
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(w)}>
                    Edit
                  </Button>
                  {confirmDelete === w.id ? (
                    <>
                      <Button size="sm" variant="danger" onClick={() => remove(w)}>
                        Confirm delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={w._count.attendance > 0}
                      title={w._count.attendance > 0 ? "Has attendance history that wages and costs depend on" : undefined}
                      onClick={() => setConfirmDelete(w.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          rows={rows}
          keyFor={(w) => w.id}
          emptyState={<EmptyState title={data.workers.length ? "No workers match" : "No workers yet"} description="Add the mill's workers to start marking attendance." />}
        />
      )}

      <Drawer open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add worker" : "Edit worker"}>
        {editing && (
          <WorkerForm
            key={editing === "new" ? "new" : editing.id}
            worker={editing === "new" ? null : editing}
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

function WorkerForm({ worker, onSaved }: { worker: WorkerRow | null; onSaved: () => void }) {
  const form = useZodForm(workerSchema, {
    name: worker?.name ?? "",
    role: worker?.role ?? "",
    dailyWage: worker ? String(worker.dailyWage) : "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.validate()) return;
    form.setSubmitting(true);
    const res = await postJson(worker ? `/api/workers/${worker.id}` : "/api/workers", form.values, worker ? "PATCH" : "POST");
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the worker"] });
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Input label="Name" name="name" autoComplete="off" {...form.field("name")} />
      <Select label="Role" name="role" placeholder="Select role" options={WORKER_ROLES.map((r) => ({ value: r, label: roleLabel(r) }))} {...form.field("role")} />
      <Input label="Daily wage (₹)" name="dailyWage" type="number" step="0.01" min="0" inputMode="decimal" {...form.field("dailyWage")} />
      {worker && <p className="text-xs text-gray-500">Changing the wage re-prices this worker&apos;s past attendance in costs and summaries too.</p>}
      {form.errors._form && <p className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : worker ? "Save changes" : "Add worker"}
      </Button>
    </form>
  );
}
