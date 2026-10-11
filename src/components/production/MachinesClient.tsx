"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { machineEditSchema, machineSchema, machineStatusChangeSchema } from "@/lib/validation/production";
import { readApi, writeApi, type FieldErrors } from "./api";
import type { FloorMachine, MachineResponse } from "./types";
import { useProductionRealtime } from "./useProductionRealtime";
import { Pager } from "@/components/ui";
import { usePaged } from "@/lib/usePaged";

const statuses = ["RUNNING", "IDLE", "BREAKDOWN", "MAINTENANCE"] as const;

export function MachinesClient() {
  const [data, setData] = useState<MachineResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [formErrors, setFormErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const refresh = useCallback(() => {
    readApi<MachineResponse>("/api/machines").then(setData).catch((error) => setLoadError(error.message));
  }, []);
  useEffect(refresh, [refresh]);
  useProductionRealtime(refresh);

  async function createMachine(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const parsed = machineSchema.safeParse(values);
    if (!parsed.success) { setFormErrors(parsed.error.flatten().fieldErrors); return; }
    setBusy(true);
    const result = await writeApi("/api/machines", "POST", parsed.data);
    setBusy(false);
    if (!result.ok) { setFormErrors(result.fieldErrors); setLoadError(result.error ?? ""); return; }
    setFormErrors({});
    form.reset();
    refresh();
  }

  async function changeStatus(id: string, status: string) {
    const parsed = machineStatusChangeSchema.safeParse({ status });
    if (!parsed.success) return;
    const result = await writeApi(`/api/machines/${id}/status`, "PATCH", parsed.data);
    if (!result.ok) setLoadError(Object.values(result.fieldErrors).flat().join(" ") || result.error);
    refresh();
  }

  const visibleMachines = data?.machines.filter((machine) => machine.name.toLowerCase().includes(query.toLowerCase()) && (!statusFilter || machine.status === statusFilter)) ?? [];
  const paged = usePaged(visibleMachines);

  return <div className="production-page">
    <h1>Machines</h1>
    <p className="production-muted">Set machine availability and capacity for each shift.</p>
    {loadError && <p role="alert" className="production-error">{loadError}</p>}
    <div className="production-grid">
      <section className="production-panel">
        <h2>Add machine</h2>
        <form className="production-form" onSubmit={createMachine} noValidate>
          <label>Name<input name="name" required aria-describedby="machine-name-error" /></label>
          {formErrors.name && <small id="machine-name-error" className="production-error">{formErrors.name[0]}</small>}
          <label>Type<select name="type" defaultValue="loom"><option value="spinning">Spinning</option><option value="loom">Loom</option><option value="dyeing">Dyeing</option></select></label>
          {formErrors.type && <small className="production-error">{formErrors.type[0]}</small>}
          <label>Capacity (metres per shift)<input name="capacityMetresPerShift" type="number" min="0" step="any" required /></label>
          {formErrors.capacityMetresPerShift && <small className="production-error">{formErrors.capacityMetresPerShift[0]}</small>}
          <label>Current status<select name="status" defaultValue="IDLE">{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          <button type="submit" disabled={busy}>{busy ? "Saving…" : "Add machine"}</button>
        </form>
      </section>
      <section className="production-panel">
        <h2>Machine list</h2>
        <div className="production-actions">
          <label>Search <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Machine name" /></label>
          <label>Filter status <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
        </div>
        {!data && !loadError && <p className="production-loading" role="status">Loading machines…</p>}
        {data?.machines.length === 0 && <p>No machines yet. Add the first machine.</p>}
        {data && data.machines.length > 0 && visibleMachines.length === 0 && <p>No machines match these filters.</p>}
        <div className="production-list">{paged.pageRows.map((machine) => <MachineCard key={machine.id} machine={machine} onStatus={changeStatus} onChanged={refresh} />)}</div>
        {paged.showPager && <Pager {...paged.pagerProps} />}
      </section>
    </div>
  </div>;
}

function MachineCard({ machine, onStatus, onChanged }: { machine: FloorMachine; onStatus: (id: string, status: string) => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = machineEditSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setErrors(parsed.error.flatten().fieldErrors); return; }
    const result = await writeApi(`/api/machines/${machine.id}`, "PATCH", parsed.data);
    if (!result.ok) { setErrors(result.fieldErrors); setError(result.error ?? ""); return; }
    setEditing(false); setErrors({}); setError(""); onChanged();
  }

  async function remove() {
    if (!window.confirm(`Remove ${machine.name}? This is only possible when it has no production history.`)) return;
    const result = await writeApi(`/api/machines/${machine.id}`, "DELETE");
    if (!result.ok) { setError(Object.values(result.fieldErrors).flat().join(" ") || result.error); return; }
    onChanged();
  }

  async function requestMaintenance() {
    const description = window.prompt(`Describe the problem with ${machine.name}:`);
    if (!description) return;
    const result = await writeApi("/api/maintenance-requests", "POST", { machineId: machine.id, description });
    if (!result.ok) { setError(Object.values(result.fieldErrors).flat().join(" ") || result.error); return; }
    setError("");
    window.alert("Maintenance request raised. The owner will review it in Approvals.");
  }

  return <article className="production-panel production-status" data-status={machine.status}>
    <strong>{machine.name}</strong> <span className="production-muted">{machine.type}</span>
    <p>{machine.capacityMetresPerShift} m / shift · {machine.todayMetres} m today</p>
    {machine.currentWorkOrder && <p>Current order: {machine.currentWorkOrder.order.orderNo}</p>}
    <label>Status <select value={machine.status} onChange={(event) => onStatus(machine.id, event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
    {error && <p role="alert" className="production-error">{error}</p>}
    <div className="production-actions">
      <button type="button" onClick={() => setEditing(!editing)}>{editing ? "Cancel edit" : "Edit"}</button>
      <button type="button" onClick={remove}>Remove</button>
      {machine.status === "BREAKDOWN" && <button type="button" onClick={requestMaintenance}>Request maintenance</button>}
    </div>
    {editing && <form className="production-form" onSubmit={save} noValidate>
      <label>Name<input name="name" defaultValue={machine.name} required /></label>
      {errors.name && <small className="production-error">{errors.name[0]}</small>}
      <label>Type<select name="type" defaultValue={machine.type}><option value="spinning">Spinning</option><option value="loom">Loom</option><option value="dyeing">Dyeing</option></select></label>
      {errors.type && <small className="production-error">{errors.type[0]}</small>}
      <label>Capacity (metres per shift)<input name="capacityMetresPerShift" type="number" min="0" step="any" defaultValue={machine.capacityMetresPerShift} required /></label>
      {errors.capacityMetresPerShift && <small className="production-error">{errors.capacityMetresPerShift[0]}</small>}
      <button type="submit">Save changes</button>
    </form>}
  </article>;
}
