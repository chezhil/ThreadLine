"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { statusBadgeClass } from "@/lib/tokens";
import { currentMonthKey } from "@/lib/accounts/period";
import { inr, inrShort, num, pct } from "@/lib/accounts/format";
import { alertKindLabel, formatAlertTime, severityStatus, type NotificationRow } from "@/lib/accounts/alert-format";
import type { MonthSummary } from "@/lib/accounts/summary";
import type { MonthPool, OrderCosting } from "@/lib/accounts/costing";
import type { MachineOutput } from "@/lib/accounts/machine-output";
import { MonthPicker } from "@/components/accounts/MonthPicker";
import { ErrorNote, Loading, PageTitle, Stat } from "@/components/accounts/Stat";

// The owner's one screen. Each panel loads on its own, so a module whose
// endpoint isn't live yet shows an empty state instead of breaking the page.

export function DashboardClient() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const summary = useApi<MonthSummary>(`/api/analytics/profit-month?month=${month}`);
  const costs = useApi<{ realised: OrderCosting[]; inProgress: OrderCosting[]; pool: MonthPool | null }>(
    `/api/analytics/cost-per-order?month=${month}`,
  );
  const output = useApi<MachineOutput>("/api/analytics/machine-output?days=7");
  const alerts = useApi<{ notifications: NotificationRow[]; unreadCount: number }>("/api/alerts?unread=1&limit=5");
  const approvals = useApi<PendingApprovals>("/api/approvals/pending");

  useRealtimeEvent(RealtimeEvents.OrderStatus, () => {
    summary.refetch();
    costs.refetch();
  });
  useRealtimeEvent(RealtimeEvents.MachineStatus, () => output.refetch());
  useRealtimeEvent(RealtimeEvents.NotificationNew, () => {
    alerts.refetch();
    approvals.refetch();
  });

  const s = summary.data;
  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Owner dashboard"
        subtitle="Any order, any roll, any rupee — from live mill data."
        action={<MonthPicker month={month} onChange={setMonth} max={thisMonth} />}
      />

      {approvals.data && approvals.data.total > 0 && <ApprovalsWaiting data={approvals.data} />}

      {summary.error && <ErrorNote message={`Couldn't load the month summary: ${summary.error}`} onRetry={summary.refetch} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Net profit (booked)"
          value={s ? inrShort(s.pnl.netProfit) : "…"}
          tone={s && s.pnl.netProfit < 0 ? "bad" : s?.pnl.ordersRealised ? "good" : "default"}
          hint={s ? (s.pnl.ordersRealised ? `${s.pnl.ordersRealised} order(s) · margin ${pct(s.pnl.marginPct)}` : "No order invoiced yet") : undefined}
        />
        <Stat label="Revenue booked" value={s ? inrShort(s.pnl.revenue) : "…"} hint={s ? `GST invoiced ${inrShort(s.cash.gstInvoiced)}` : undefined} />
        <Stat label="Cash received" value={s ? inrShort(s.cash.paymentsReceived) : "…"} hint={s ? `Bills ${inrShort(s.cash.expensesTotal)}` : undefined} />
        <Stat
          label="Receivables"
          value={s ? inrShort(s.receivables.outstanding) : "…"}
          tone={s && s.receivables.outstanding > 0 ? "bad" : "default"}
          hint={s ? `${s.receivables.invoicesOpen} open invoice(s)` : undefined}
        />
        <Stat
          label="Output today"
          value={output.data ? `${num(output.data.totals.todayOutput)} m` : output.error ? "—" : "…"}
          hint={output.data ? `${num(output.data.totals.periodOutput)} m in 7 days` : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2 *:min-w-0">
        <ProfitPanel data={costs.data} loading={costs.loading} error={costs.error} retry={costs.refetch} />
        <DefectsPanel />
        <MachinePanel data={output.data} loading={output.loading} error={output.error} retry={output.refetch} />
        <AlertsPanel data={alerts.data} loading={alerts.loading} error={alerts.error} />
      </div>
    </div>
  );
}

interface PendingApprovals {
  purchase: number;
  maintenance: number;
  payouts: number;
  total: number;
}

function ApprovalsWaiting({ data }: { data: PendingApprovals }) {
  const parts = [
    data.purchase && `${data.purchase} yarn purchase${data.purchase === 1 ? "" : "s"}`,
    data.maintenance && `${data.maintenance} maintenance`,
    data.payouts && `${data.payouts} wage payout${data.payouts === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <Link
      href="/approvals"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100"
    >
      <span>
        <span className="font-semibold">
          {data.total} approval{data.total === 1 ? "" : "s"} waiting for you
        </span>{" "}
        · {parts.join(", ")}
      </span>
      <span className="font-medium">Review →</span>
    </Link>
  );
}

function ProfitPanel({
  data,
  loading,
  error,
  retry,
}: {
  data: { realised: OrderCosting[]; inProgress: OrderCosting[]; pool: MonthPool | null } | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  const realised = [...(data?.realised ?? [])].sort((a, b) => a.profit - b.profit);
  const maxAbs = Math.max(1, ...realised.map((o) => Math.abs(o.profit)));
  return (
    <Card>
      <CardHeader title="Profit per order (this month)" action={<Link href="/accounts/costing" className="text-xs font-medium text-brand hover:underline">Cost breakdown →</Link>} />
      {error && <ErrorNote message={`Couldn't load order costs: ${error}`} onRetry={retry} />}
      {loading && !data && <Loading />}
      {data &&
        (realised.length === 0 ? (
          <EmptyState title="No order invoiced this month" description={data.inProgress.length ? `${data.inProgress.length} order(s) in progress; profit is booked when they're invoiced.` : "Profit appears once orders are invoiced."} />
        ) : (
          <ul className="flex flex-col gap-2">
            {realised.map((o, i) => (
              <li key={o.orderId}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    <span className="font-medium">{o.orderNo}</span> <span className="text-gray-500">{o.buyerName}</span>
                    {i === 0 && realised.length > 1 && <span className="ml-2 text-xs text-amber-700">least profit</span>}
                    {o.dataGaps.length > 0 && <span className="ml-2 text-xs text-amber-700" title={o.dataGaps.join("\n")}>data gaps</span>}
                  </span>
                  <span className={`tabular-nums font-semibold ${o.profit < 0 ? "text-red-700" : "text-green-700"}`}>
                    {inr(o.profit)} <span className="text-xs font-normal text-gray-500">{pct(o.marginPct)}</span>
                  </span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-gray-100">
                  <div className={`h-2 rounded-full ${o.profit < 0 ? "bg-red-500" : "bg-green-500"}`} style={{ width: `${(Math.abs(o.profit) / maxAbs) * 100}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-gray-500">
                  Revenue {inr(o.revenue)} · true cost {inr(o.totalCost)}
                </p>
              </li>
            ))}
          </ul>
        ))}
      {data && data.inProgress.length > 0 && realised.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          Plus {data.inProgress.length} order(s) in progress with {inr(data.inProgress.reduce((s, o) => s + o.totalCost, 0))} cost to date.
        </p>
      )}
    </Card>
  );
}

interface DefectsResponse {
  callouts: string[];
  summary: { totalInspected: number; rejectRate: number };
  byMachine: { id: string; name: string; reject: number; total: number; rejectRate: number }[];
}

// Reads Module 3's /api/analytics/defects.
function DefectsPanel() {
  const [state, setState] = useState<{ status: "loading" | "ok" | "error"; data?: DefectsResponse; message?: string }>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/analytics/defects?days=30")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) return setState({ status: "error", message: `Request failed (${res.status})` });
        const json = (await res.json()) as DefectsResponse;
        if (!cancelled) setState({ status: "ok", data: json });
      })
      .catch((e) => !cancelled && setState({ status: "error", message: e instanceof Error ? e.message : "Network error" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader title="Quality callouts (30 days)" action={<Link href="/quality/defects" className="text-xs font-medium text-brand hover:underline">Defect analytics →</Link>} />
      {state.status === "loading" && <Loading />}
      {state.status === "error" && <ErrorNote message={`Couldn't load defect analytics: ${state.message}`} />}
      {state.status === "ok" && state.data && (
        state.data.summary.totalInspected === 0 ? (
          <EmptyState title="No rolls inspected in the last 30 days" />
        ) : (
          <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
              {state.data.callouts.map((c) => (
                <li key={c} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {c}
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-500">
              {state.data.summary.totalInspected} rolls inspected · overall reject rate {pct(state.data.summary.rejectRate)}
            </p>
          </div>
        )
      )}
    </Card>
  );
}

function MachinePanel({ data, loading, error, retry }: { data: MachineOutput | null; loading: boolean; error: string | null; retry: () => void }) {
  const machines = data?.machines ?? [];
  const peak = Math.max(1, ...machines.flatMap((m) => m.daily.map((d) => d.qty)));
  return (
    <Card>
      <CardHeader title="Machine output (7 days)" action={<Link href="/production/floor-board" className="text-xs font-medium text-brand hover:underline">Floor board →</Link>} />
      {error && <ErrorNote message={`Couldn't load machine output: ${error}`} onRetry={retry} />}
      {loading && !data && <Loading />}
      {data &&
        (machines.length === 0 ? (
          <EmptyState title="No machines yet" description="Machine output appears once Production adds machines and logs output." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500">
                  <th className="py-1 pr-2 font-medium">Machine</th>
                  <th className="py-1 pr-2 font-medium">Status</th>
                  <th className="py-1 pr-2 text-right font-medium">Today</th>
                  <th className="py-1 pr-2 text-right font-medium">7 days</th>
                  <th className="py-1 pr-2 text-right font-medium">Utilisation</th>
                  <th className="py-1 font-medium">Daily</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {machines.map((m) => (
                  <tr key={m.machineId}>
                    <td className="whitespace-nowrap py-1.5 pr-2 font-medium">{m.name}</td>
                    <td className="py-1.5 pr-2"><Badge status={m.status} /></td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{num(m.todayOutput)} m</td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{num(m.periodOutput)} m</td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums" title={`${m.shiftsLogged} shift(s) logged`}>
                      {m.utilisationPct != null && m.utilisationPct > 100 ? (
                        <span
                          className="text-amber-700"
                          title={`Logged ${num(m.periodOutput)} m in ${m.shiftsLogged} shift(s), above the rated ${num(m.capacityMetresPerShift)} m/shift. Check the production log or the machine's capacity.`}
                        >
                          over rated
                        </span>
                      ) : (
                        pct(m.utilisationPct, 0)
                      )}
                    </td>
                    <td className="py-1.5">
                      <div className="flex h-6 items-end gap-0.5" aria-label={`Daily output for ${m.name}`}>
                        {m.daily.map((d) => (
                          <div key={d.date} title={`${d.date}: ${num(d.qty)} m`} className="w-2 rounded-sm bg-brand/70" style={{ height: `${Math.max(d.qty > 0 ? 8 : 2, (d.qty / peak) * 100)}%` }} />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </Card>
  );
}

function AlertsPanel({ data, loading, error }: { data: { notifications: NotificationRow[]; unreadCount: number } | null; loading: boolean; error: string | null }) {
  return (
    <Card>
      <CardHeader title={`Unread alerts${data ? ` (${data.unreadCount})` : ""}`} action={<Link href="/alerts" className="text-xs font-medium text-brand hover:underline">All alerts →</Link>} />
      {error && <ErrorNote message={`Couldn't load alerts: ${error}`} />}
      {loading && !data && <Loading />}
      {data &&
        (data.notifications.length === 0 ? (
          <EmptyState title="No unread alerts" />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {data.notifications.map((n) => (
              <li key={n.id} className="py-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(severityStatus(n.severity))}`}>{alertKindLabel(n.type)}</span>
                  <span className="text-xs text-gray-400">{formatAlertTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-gray-700">{n.message}</p>
              </li>
            ))}
          </ul>
        ))}
    </Card>
  );
}
