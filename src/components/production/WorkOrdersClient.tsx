"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { productionLogSchema, workOrderSchema } from "@/lib/validation/production";
import { readApi, writeApi, type FieldErrors } from "./api";
import type { WorkOrderResponse } from "./types";
import { useProductionRealtime } from "./useProductionRealtime";
import { WorkOrderCard } from "./WorkOrderCard";

const machineTypeForStage: Record<string, string> = { spinning: "spinning", weaving: "loom", dyeing: "dyeing" };

export function WorkOrdersClient() {
  const [data, setData] = useState<WorkOrderResponse | null>(null);
  const [stage, setStage] = useState("spinning");
  const [error, setError] = useState("");
  const [createErrors, setCreateErrors] = useState<FieldErrors>({});
  const [logErrors, setLogErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const refresh = useCallback(() => {
    readApi<WorkOrderResponse>("/api/work-orders").then(setData).catch((failure) => setError(failure.message));
  }, []);
  useEffect(refresh, [refresh]);
  useProductionRealtime(refresh);

  async function createWorkOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = workOrderSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) { setCreateErrors(parsed.error.flatten().fieldErrors); return; }
    setBusy(true);
    const result = await writeApi("/api/work-orders", "POST", parsed.data);
    setBusy(false);
    if (!result.ok) { setCreateErrors(result.fieldErrors); setError(result.error ?? ""); return; }
    setCreateErrors({});
    form.reset();
    refresh();
  }

  async function logOutput(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = productionLogSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) { setLogErrors(parsed.error.flatten().fieldErrors); return; }
    setBusy(true);
    const result = await writeApi("/api/production-logs", "POST", parsed.data);
    setBusy(false);
    if (!result.ok) { setLogErrors(result.fieldErrors); setError(result.error ?? ""); return; }
    setLogErrors({});
    form.reset();
    refresh();
  }

  const active = data?.workOrders.filter((workOrder) => workOrder.status !== "COMPLETED") ?? [];
  const visibleWorkOrders = data?.workOrders.filter((workOrder) =>
    (`${workOrder.order.orderNo} ${workOrder.machine.name}`).toLowerCase().includes(query.toLowerCase()) && (!statusFilter || workOrder.status === statusFilter)
  ) ?? [];
  return <div className="production-page">
    <h1>Work orders & production</h1>
    <p className="production-muted">Assign each stage to a machine, then record shift output in metres. A mistyped entry can be corrected under each work order.</p>
    {error && <p role="alert" className="production-error">{error}</p>}
    <div className="production-grid">
      <section className="production-panel">
        <h2>Create work order</h2>
        <form className="production-form" onSubmit={createWorkOrder} noValidate>
          <label>Order<select name="orderId" defaultValue="" required><option value="">Choose an order</option>{data?.orders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} ({order.status})</option>)}</select></label>
          {createErrors.orderId && <small className="production-error">{createErrors.orderId[0]}</small>}
          <label>Stage<select name="stage" value={stage} onChange={(event) => setStage(event.target.value)}><option value="spinning">Spinning</option><option value="weaving">Weaving</option><option value="dyeing">Dyeing</option></select></label>
          {createErrors.stage && <small className="production-error">{createErrors.stage[0]}</small>}
          <label>Machine<select name="machineId" defaultValue="" key={stage} required><option value="">Choose a machine</option>{data?.machines.filter((machine) => machine.type === machineTypeForStage[stage]).map((machine) => <option key={machine.id} value={machine.id}>{machine.name} ({machine.status})</option>)}</select></label>
          {createErrors.machineId && <small className="production-error">{createErrors.machineId[0]}</small>}
          <label>Planned quantity (metres)<input name="plannedQty" type="number" min="0" step="any" required /></label>
          {createErrors.plannedQty && <small className="production-error">{createErrors.plannedQty[0]}</small>}
          <button type="submit" disabled={busy || !data}>{busy ? "Saving…" : "Create work order"}</button>
        </form>
      </section>
      <section className="production-panel">
        <h2>Record shift output</h2>
        <form className="production-form" onSubmit={logOutput} noValidate>
          <label>Work order<select name="workOrderId" defaultValue="" required><option value="">Choose a work order</option>{active.map((workOrder) => <option key={workOrder.id} value={workOrder.id}>{workOrder.order.orderNo} · {workOrder.stage} · {workOrder.machine.name}</option>)}</select></label>
          {logErrors.workOrderId && <small className="production-error">{logErrors.workOrderId[0]}</small>}
          <label>Shift<input name="shift" placeholder="Morning / Evening" required /></label>
          {logErrors.shift && <small className="production-error">{logErrors.shift[0]}</small>}
          <label>Produced (metres)<input name="qtyProduced" type="number" min="0" step="any" required /></label>
          {logErrors.qtyProduced && <small className="production-error">{logErrors.qtyProduced[0]}</small>}
          <button type="submit" disabled={busy || !active.length}>{busy ? "Saving…" : "Record output"}</button>
        </form>
      </section>
    </div>
    <section className="production-panel">
      <h2>Production progress</h2>
      <div className="production-actions">
        <label>Search <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order or machine" /></label>
        <label>Filter status <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option><option value="PLANNED">Planned</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option></select></label>
      </div>
      {!data && !error && <p>Loading work orders…</p>}
      {data?.workOrders.length === 0 && <p>No work orders yet.</p>}
      {data && data.workOrders.length > 0 && visibleWorkOrders.length === 0 && <p>No work orders match these filters.</p>}
      <div className="production-grid">{visibleWorkOrders.map((workOrder) => <WorkOrderCard key={workOrder.id} workOrder={workOrder} machines={data?.machines ?? []} onChanged={refresh} />)}</div>
    </section>
  </div>;
}
