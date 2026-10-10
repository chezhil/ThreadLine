"use client";
import { useMemo, useState } from "react";
import { Badge, Card, CardHeader, Drawer, EmptyState, Input, Select, Table } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { currentMonthKey } from "@/lib/accounts/period";
import { dateIN, inr, num, pct } from "@/lib/accounts/format";
import type { MonthPool, OrderCosting, RollCost } from "@/lib/accounts/costing";
import { MonthPicker } from "./MonthPicker";
import { ErrorNote, Loading, PageTitle } from "./Stat";

const COST_LINES: { key: keyof OrderCosting["costs"]; label: string; how: string }[] = [
  { key: "yarn", label: "Yarn", how: "roll weight × lot's yarn price" },
  { key: "processWastage", label: "Process wastage", how: "8% of roll yarn (feasibility default)" },
  { key: "directWages", label: "Direct wages", how: "attendance on the machines that made it" },
  { key: "power", label: "Power", how: "month's power bills ÷ machine-shifts" },
  { key: "overhead", label: "Overhead", how: "month's overhead + other bills ÷ machine-shifts" },
  { key: "indirectLabour", label: "Indirect labour", how: "wages not on a producing machine ÷ machine-shifts" },
  { key: "directExpenses", label: "Direct bills", how: "expenses linked to this order" },
];

type View = "month" | "all";

export function CostingClient() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [view, setView] = useState<View>("month");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const url = view === "month" ? `/api/analytics/cost-per-order?month=${month}` : "/api/analytics/cost-per-order";
  const { data, loading, error, refetch } = useApi<{
    orders?: OrderCosting[];
    realised?: OrderCosting[];
    inProgress?: OrderCosting[];
    pool?: MonthPool | null;
  }>(url);
  useRealtimeEvent(RealtimeEvents.OrderStatus, () => refetch());

  const rows = useMemo(() => {
    const all = view === "month" ? [...(data?.realised ?? []), ...(data?.inProgress ?? [])] : data?.orders ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter(
      (o) =>
        (!stage || o.stage === stage) &&
        (!needle || o.orderNo.toLowerCase().includes(needle) || o.buyerName.toLowerCase().includes(needle)),
    );
  }, [data, view, q, stage]);

  const finals = rows.filter((o) => o.stage === "final");
  const totals = {
    revenue: finals.reduce((s, o) => s + o.revenue, 0),
    cost: finals.reduce((s, o) => s + o.totalCost, 0),
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="True cost per order"
        subtitle="Computed from rolls, yarn lots, production logs, attendance and expenses. Click an order to see where every rupee comes from."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="View"
              value={view}
              onChange={(e) => setView(e.target.value as View)}
              options={[
                { value: "month", label: "Orders of a month" },
                { value: "all", label: "All orders" },
              ]}
            />
            {view === "month" && <MonthPicker month={month} onChange={setMonth} max={thisMonth} />}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Input aria-label="Search orders" placeholder="Search order no. or buyer" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          aria-label="Stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          options={[
            { value: "", label: "Final and in progress" },
            { value: "final", label: "Final (invoiced/dispatched)" },
            { value: "in_progress", label: "In progress (cost to date)" },
          ]}
        />
      </div>

      {error && <ErrorNote message={`Couldn't load costs: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          {finals.length > 0 && (
            <p className="text-sm text-gray-600">
              {finals.length} final order(s): revenue {inr(totals.revenue)}, true cost {inr(totals.cost)}, profit{" "}
              <span className={totals.revenue - totals.cost < 0 ? "font-semibold text-red-700" : "font-semibold text-green-700"}>
                {inr(totals.revenue - totals.cost)}
              </span>
              .
            </p>
          )}
          <Table
            columns={[
              {
                header: "Order",
                render: (o: OrderCosting) => (
                  <button type="button" className="font-medium text-brand hover:underline" onClick={() => setSelected(o.orderId)}>
                    {o.orderNo}
                  </button>
                ),
              },
              { header: "Buyer", render: (o) => o.buyerName },
              { header: "Status", render: (o) => <Badge status={o.status} /> },
              { header: "Revenue", className: "text-right tabular-nums", render: (o) => inr(o.revenue) },
              { header: "True cost", className: "text-right tabular-nums", render: (o) => inr(o.totalCost) },
              {
                header: "Profit",
                className: "text-right tabular-nums",
                render: (o) =>
                  o.stage === "final" ? (
                    <span className={o.profit < 0 ? "font-semibold text-red-700" : "font-semibold text-green-700"}>{inr(o.profit)}</span>
                  ) : (
                    <span className="text-gray-400" title="Not final until invoiced">—</span>
                  ),
              },
              { header: "Margin", className: "text-right tabular-nums", render: (o) => (o.stage === "final" ? pct(o.marginPct) : "—") },
              { header: "Cost / m", className: "text-right tabular-nums", render: (o) => (o.costPerMetre == null ? "—" : inr(o.costPerMetre, { decimals: true })) },
              {
                header: "Data",
                render: (o) =>
                  o.dataGaps.length ? (
                    <span className="text-xs text-amber-700" title={o.dataGaps.join("\n")}>
                      {o.dataGaps.length} gap(s)
                    </span>
                  ) : (
                    <span className="text-xs text-green-700">complete</span>
                  ),
              },
            ]}
            rows={rows}
            keyFor={(o) => o.orderId}
            emptyState={
              <EmptyState
                title={view === "month" ? "No orders invoiced or in progress this month" : "No orders yet"}
                description="Orders appear here once they exist; profit is final once an order is invoiced."
              />
            }
          />
          {view === "month" && data.pool && data.pool.unabsorbed > 0 && (
            <p className="text-sm text-amber-700">
              {inr(data.pool.unabsorbed)} of this month&apos;s power, overhead and indirect wages could not be spread onto any order because no production was logged this month.
            </p>
          )}
        </>
      )}

      <Drawer open={!!selected} onClose={() => setSelected(null)} title="Order cost breakdown">
        {selected && <OrderBreakdown orderId={selected} />}
      </Drawer>
    </div>
  );
}

function OrderBreakdown({ orderId }: { orderId: string }) {
  const { data, loading, error } = useApi<{ order: OrderCosting; rolls: RollCost[] }>(
    `/api/analytics/cost-per-order?orderId=${encodeURIComponent(orderId)}`,
  );
  if (loading) return <Loading />;
  if (error || !data) return <ErrorNote message={`Couldn't load the breakdown: ${error ?? "no data"}`} />;
  const o = data.order;
  const maxLine = Math.max(1, ...Object.values(o.costs));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-base font-semibold text-foreground">{o.orderNo}</p>
        <p className="text-sm text-gray-500">
          {o.buyerName} · {o.fabric} · {num(o.qtyMetres)} m @ {inr(o.pricePerMetre, { decimals: true })}/m
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Badge status={o.status} />
          <span className="text-xs text-gray-500">{o.stage === "final" ? `Final · invoiced ${dateIN(o.invoicedAt)}` : "In progress · cost to date"}</span>
        </div>
      </div>

      <Card>
        <CardHeader title="Profit" />
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-gray-500">Revenue</p>
            <p className="font-semibold tabular-nums">{inr(o.revenue)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">True cost</p>
            <p className="font-semibold tabular-nums">{inr(o.totalCost)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">{o.stage === "final" ? "Profit" : "Value − cost so far"}</p>
            <p className={`font-semibold tabular-nums ${o.stage !== "final" ? "text-foreground" : o.profit < 0 ? "text-red-700" : "text-green-700"}`}>{inr(o.profit)}</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Where the cost comes from" />
        <div className="flex flex-col gap-2">
          {COST_LINES.map((l) => (
            <div key={l.key}>
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">{l.label}</span>
                <span className="tabular-nums">{inr(o.costs[l.key])}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${(o.costs[l.key] / maxLine) * 100}%` }} />
              </div>
              <p className="text-xs text-gray-400">{l.how}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Source rows" />
        <ul className="space-y-1 text-sm text-gray-600">
          <li>{o.trace.rolls} roll(s), {num(o.trace.rollMetres, 1)} m, {num(o.trace.rollKg, 1)} kg</li>
          <li>{o.trace.rejectedRolls} rejected roll(s): {num(o.trace.rejectedRollKg, 1)} kg of yarn worth {inr(o.trace.rejectedYarnCost)} wasted</li>
          <li>{o.trace.productionLogs} production log(s) over {num(o.trace.machineShiftUnits, 2)} machine-shift(s)</li>
          <li>{o.trace.directAttendanceMarks} attendance mark(s) charged directly</li>
          <li>{o.trace.linkedExpenses} expense(s) linked to this order</li>
          <li>Invoiced {inr(o.invoicedTotal)} incl. GST · paid {inr(o.paid)} · outstanding {inr(o.outstanding)}</li>
        </ul>
      </Card>

      <LedgerCard orderId={o.orderId} />

      {o.dataGaps.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">Data gaps</p>
          <ul className="mt-1 list-disc pl-5">
            {o.dataGaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold text-foreground">Cost per roll</p>
        <Table
          columns={[
            { header: "Roll", render: (r: RollCost) => r.rollNo },
            { header: "QC", render: (r) => <Badge status={r.qcStatus} /> },
            { header: "Length", className: "text-right tabular-nums", render: (r) => `${num(r.lengthMetres, 1)} m` },
            { header: "Yarn", className: "text-right tabular-nums", render: (r) => inr(r.yarnCost) },
            { header: "Conversion", className: "text-right tabular-nums", render: (r) => inr(r.conversionCost) },
            { header: "₹ / m", className: "text-right tabular-nums", render: (r) => inr(r.costPerMetre, { decimals: true }) },
          ]}
          rows={data.rolls}
          keyFor={(r) => r.rollId}
          emptyState={<EmptyState title="No rolls yet" description="Rolls appear once production mints them." />}
        />
      </div>
    </div>
  );
}

const LEDGER_TYPE_LABEL: Record<string, string> = {
  revenue: "Revenue",
  yarn_cost: "Yarn cost",
  wage_cost: "Wage cost",
  power_cost: "Power cost",
  overhead: "Overhead",
  payment_received: "Payment received",
  reversal: "Reversal",
};

interface LedgerEntryRow {
  id: string;
  date: string;
  type: string;
  amount: number;
  sourceType: string;
  sourceId: string;
  reversesId: string | null;
  note: string | null;
}

/** HARDENING_ADDENDUM.md item 3's stated payoff: "show me where this number
 * came from" is a list of ledger rows, not a re-explained query. Additive —
 * the cost breakdown above is still computed from costing.ts, unchanged;
 * this is the parallel audit trail sitting alongside it. */
function LedgerCard({ orderId }: { orderId: string }) {
  const { data, loading, error } = useApi<{ entries: LedgerEntryRow[]; netByType: Record<string, number> }>(
    `/api/ledger?orderId=${encodeURIComponent(orderId)}`,
  );
  return (
    <Card>
      <CardHeader title="Ledger" />
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {error && <ErrorNote message={`Couldn't load the ledger: ${error}`} />}
      {data && data.entries.length === 0 && (
        <EmptyState title="No ledger entries yet" description="Entries are posted when an invoice is raised, a payment arrives, or an expense is linked to this order." />
      )}
      {data && data.entries.length > 0 && (
        <div className="flex flex-col gap-1">
          {data.entries.map((e) => (
            <div key={e.id} className="flex items-center justify-between border-b border-border py-1 text-sm last:border-0">
              <div>
                <span className="font-medium text-foreground">{LEDGER_TYPE_LABEL[e.type] ?? e.type}</span>
                {e.reversesId && <span className="ml-1 text-xs text-amber-700">(reversal)</span>}
                <span className="ml-2 text-xs text-gray-400">{dateIN(e.date)} · {e.sourceType}</span>
              </div>
              <span className={`tabular-nums ${e.amount < 0 ? "text-red-700" : "text-foreground"}`}>{inr(e.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
