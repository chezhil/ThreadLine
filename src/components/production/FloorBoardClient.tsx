"use client";

import { useCallback, useEffect, useState } from "react";
import { readApi } from "./api";
import type { MachineResponse } from "./types";
import { useProductionRealtime } from "./useProductionRealtime";

export function FloorBoardClient() {
  const [data, setData] = useState<MachineResponse | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(() => {
    readApi<MachineResponse>("/api/machines").then((result) => { setData(result); setError(""); }).catch((failure) => setError(failure.message));
  }, []);
  useEffect(refresh, [refresh]);
  useProductionRealtime(refresh);

  return <main className="production-page">
    <h1>Live floor board</h1>
    <p className="production-muted">Machine status, current order and today’s output update as production is recorded.</p>
    {error && <p role="alert" className="production-error">{error} <button onClick={refresh}>Retry</button></p>}
    {!data && !error && <p>Loading floor board…</p>}
    {data?.machines.length === 0 && <p>No machines yet. Add a machine to start the board.</p>}
    <section aria-label="Machine status" className="production-grid">
      {data?.machines.map((machine) => {
        const current = machine.currentWorkOrder;
        const percent = current ? Math.min(100, Math.round(current.producedQty / current.plannedQty * 100)) : 0;
        return <article key={machine.id} className="production-panel production-status" data-status={machine.status}>
          <h2>{machine.name}</h2>
          <p><strong>{machine.status}</strong> · {machine.type}</p>
          <p>Today: <strong>{machine.todayMetres} m</strong></p>
          {current ? <>
            <p>Order {current.order.orderNo} · {current.stage}</p>
            <progress className="production-progress" value={percent} max={100} aria-label={`${machine.name} order progress`} />
            <p>{percent}% · {current.producedQty} / {current.plannedQty} m</p>
          </> : <p className="production-muted">No active work order</p>}
        </article>;
      })}
    </section>
    <div className="production-grid production-actions">
      <section className="production-panel">
        <h2>Orders at delay risk</h2>
        {!data?.delayRisks.length && <p>No current delay risks.</p>}
        <div className="production-list">{data?.delayRisks.map((risk) => <article key={risk.orderId}>
          <strong>{risk.orderNo}</strong> · {risk.reason}
          <p>Deadline: {new Date(risk.deadline).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} · {risk.daysAvailable} days available{risk.estimatedDays === null ? "" : ` · ${risk.estimatedDays} estimated days remaining`}</p>
        </article>)}</div>
      </section>
      <section className="production-panel">
        <h2>Yarn reorder suggestions</h2>
        {!data?.reorderSuggestions.length && <p>No reorder suggestions at current usage.</p>}
        <div className="production-list">{data?.reorderSuggestions.map((suggestion) => <article key={suggestion.yarnTypeId}>
          <strong>{suggestion.yarnName}</strong>
          <p>{suggestion.stockKg} kg left{suggestion.daysLeft === null ? "" : ` · ${suggestion.daysLeft} days at current usage`}</p>
          <p>Suggested reorder: {suggestion.reorderKg} kg</p>
        </article>)}</div>
      </section>
    </div>
  </main>;
}
