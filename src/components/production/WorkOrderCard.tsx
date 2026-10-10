"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, ConfirmButton } from "@/components/ui";
import { dateTimeIN } from "@/lib/accounts/format";
import { productionLogUpdateSchema, workOrderUpdateSchema } from "@/lib/validation/production";
import { readApi, writeApi, type FieldErrors } from "./api";
import type { ProductionLogRow, ProductionMachine, WorkOrderRow } from "./types";

const machineTypeForStage: Record<string, string> = { spinning: "spinning", weaving: "loom", dyeing: "dyeing" };

const messageOf = (result: { fieldErrors: FieldErrors; error?: string }) =>
  Object.values(result.fieldErrors).flat().filter(Boolean)[0] ?? result.error ?? "Something went wrong";

/** One work order's progress, with its corrections: re-plan or move an
 * unfinished one, delete one nothing came out of, and fix or remove a
 * mistyped output entry. The server decides what is allowed and says why. */
export function WorkOrderCard({ workOrder, machines, onChanged }: { workOrder: WorkOrderRow; machines: ProductionMachine[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const finished = workOrder.status === "COMPLETED";
  const removable = workOrder._count.productionLogs === 0 && workOrder._count.rolls === 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const changed = Object.fromEntries(
      Object.entries(values).filter(([key, value]) => String(value) !== String(key === "machineId" ? workOrder.machine.id : workOrder.plannedQty)),
    );
    if (!Object.keys(changed).length) { setEditing(false); return; }
    const parsed = workOrderUpdateSchema.safeParse(changed);
    if (!parsed.success) { setErrors(parsed.error.flatten().fieldErrors); return; }
    setBusy(true);
    const result = await writeApi(`/api/work-orders/${workOrder.id}`, "PATCH", parsed.data);
    setBusy(false);
    if (!result.ok) { setErrors(result.fieldErrors); setError(result.error ?? ""); return; }
    setEditing(false); setErrors({}); setError(""); onChanged();
  }

  async function remove() {
    const result = await writeApi(`/api/work-orders/${workOrder.id}`, "DELETE");
    if (!result.ok) return messageOf(result);
    onChanged();
    return null;
  }

  const sameStage = machines.filter((machine) => machine.type === machineTypeForStage[workOrder.stage]);

  return <article className="production-panel">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <strong className="font-display text-[15px]">{workOrder.order.orderNo}</strong> <span className="production-muted capitalize">· {workOrder.stage}</span>
        <p className="production-muted">{workOrder.machine.name}</p>
      </div>
      <Badge status={workOrder.status} />
    </div>
    <progress className="production-progress" value={workOrder.producedQty} max={workOrder.plannedQty} aria-label={`${workOrder.order.orderNo} ${workOrder.stage} progress`} />
    <p>{workOrder.producedQty} / {workOrder.plannedQty} m</p>
    {error && <p role="alert" className="production-error">{error}</p>}
    <div className="flex flex-wrap gap-2">
      {!finished && <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}>{editing ? "Cancel edit" : "Edit"}</Button>}
      <Button size="sm" variant="ghost" aria-expanded={showLogs} onClick={() => setShowLogs(!showLogs)}>
        {showLogs ? "Hide output entries" : `Output entries (${workOrder._count.productionLogs})`}
      </Button>
      {removable && <ConfirmButton label="Delete" confirmLabel="Confirm delete" onConfirm={remove} />}
    </div>
    {editing && <form className="production-form mt-3" onSubmit={save} noValidate>
      <label>Machine<select name="machineId" defaultValue={workOrder.machine.id}>{sameStage.map((machine) => <option key={machine.id} value={machine.id}>{machine.name} ({machine.status})</option>)}</select></label>
      {errors.machineId && <small className="production-error">{errors.machineId[0]}</small>}
      <label>Planned quantity (metres)<input name="plannedQty" type="number" min="0" step="any" defaultValue={workOrder.plannedQty} required /></label>
      {errors.plannedQty && <small className="production-error">{errors.plannedQty[0]}</small>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
    </form>}
    {showLogs && <OutputEntries workOrderId={workOrder.id} onChanged={onChanged} />}
  </article>;
}

function OutputEntries({ workOrderId, onChanged }: { workOrderId: string; onChanged: () => void }) {
  const [logs, setLogs] = useState<ProductionLogRow[] | null>(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => {
    readApi<{ logs: ProductionLogRow[] }>(`/api/production-logs?workOrderId=${workOrderId}`)
      .then((data) => { setLogs(data.logs); setLoadError(""); })
      .catch((failure) => setLoadError(failure.message));
  }, [workOrderId]);
  useEffect(load, [load]);

  function changed() { load(); onChanged(); }

  if (loadError) return <p role="alert" className="production-error">{loadError} <button type="button" onClick={load}>Retry</button></p>;
  if (!logs) return <p className="production-muted">Loading output entries…</p>;
  if (!logs.length) return <p className="production-muted">No output logged yet.</p>;
  return <ul className="production-list mt-3">{logs.map((log) => <OutputEntry key={log.id} log={log} onChanged={changed} />)}</ul>;
}

function OutputEntry({ log, onChanged }: { log: ProductionLogRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = productionLogUpdateSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) { setErrors(parsed.error.flatten().fieldErrors); return; }
    setBusy(true);
    const result = await writeApi(`/api/production-logs/${log.id}`, "PATCH", parsed.data);
    setBusy(false);
    if (!result.ok) { setErrors(result.fieldErrors); setError(result.error ?? ""); return; }
    setEditing(false); setErrors({}); setError(""); onChanged();
  }

  async function remove() {
    const result = await writeApi(`/api/production-logs/${log.id}`, "DELETE");
    if (!result.ok) return messageOf(result);
    onChanged();
    return null;
  }

  return <li className="border-t border-border pt-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span><strong>{log.qtyProduced} m</strong> · {log.shift} · {dateTimeIN(log.loggedAt)} · {log.loggedByName}</span>
      <span className="flex flex-wrap items-start gap-2">
        <Button size="sm" variant="secondary" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Correct"}</Button>
        <ConfirmButton label="Remove" confirmLabel="Remove entry" onConfirm={remove} />
      </span>
    </div>
    {error && <p role="alert" className="production-error">{error}</p>}
    {editing && <form className="production-form mt-2" onSubmit={save} noValidate>
      <label>Produced (metres)<input name="qtyProduced" type="number" min="0" step="any" defaultValue={log.qtyProduced} required /></label>
      {errors.qtyProduced && <small className="production-error">{errors.qtyProduced[0]}</small>}
      <label>Shift<input name="shift" defaultValue={log.shift} maxLength={40} required /></label>
      {errors.shift && <small className="production-error">{errors.shift[0]}</small>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save correction"}</button>
    </form>}
  </li>;
}
