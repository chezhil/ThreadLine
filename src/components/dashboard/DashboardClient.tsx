"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  CircleCheck,
  Download,
  Factory,
  Gauge,
  Landmark,
  Ruler,
  Search,
  Siren,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { useApi } from "@/lib/useApi";
import { useRealtimeConnected, useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { statusBadgeClass, statusColor, type StatusColorKey } from "@/lib/tokens";
import { currentMonthKey } from "@/lib/accounts/period";
import { inr, inrShort, num, pct } from "@/lib/accounts/format";
import { alertKindLabel, formatAlertTime, severityStatus, type NotificationRow } from "@/lib/accounts/alert-format";
import type { MonthSummary } from "@/lib/accounts/summary";
import type { MonthPool, OrderCosting } from "@/lib/accounts/costing";
import type { MachineOutput, MachineOutputRow } from "@/lib/accounts/machine-output";
import { MonthPicker } from "@/components/accounts/MonthPicker";
import { ErrorNote, Loading, PageTitle } from "@/components/accounts/Stat";
import { SUGGESTIONS } from "@/components/assistant/AssistantClient";

// The owner's one screen, laid out as the Stitch executive dashboard
// (design/stitch/executive-dashboard.png): four KPI tiles, the loom shed, the
// order-margin ledger, and a right rail for quality, alerts and the assistant.
// Each panel loads on its own, so a module whose endpoint isn't live yet shows
// an empty state instead of breaking the page. Every figure is live data.

/** Same two-shift day the production planner assumes (src/lib/production/insights.ts). */
const SHIFTS_PER_DAY = 2;

type Costs = { realised: OrderCosting[]; inProgress: OrderCosting[]; pool: MonthPool | null };

interface DefectsResponse {
  callouts: string[];
  summary: { totalInspected: number; totalReject: number; rejectRate: number };
  byMachine: {
    id: string;
    name: string;
    reject: number;
    total: number;
    rejectRate: number;
    shareOfTotalRejects: number;
    defects: Record<string, number>;
  }[];
}

interface PendingApprovals {
  purchase: number;
  maintenance: number;
  payouts: number;
  total: number;
}

export function DashboardClient() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const summary = useApi<MonthSummary>(`/api/analytics/profit-month?month=${month}`);
  const costs = useApi<Costs>(`/api/analytics/cost-per-order?month=${month}`);
  const output = useApi<MachineOutput>("/api/analytics/machine-output?days=7");
  const defects = useApi<DefectsResponse>("/api/analytics/defects?days=30");
  const alerts = useApi<{ notifications: NotificationRow[]; unreadCount: number }>("/api/alerts?unread=1&limit=5");
  const approvals = useApi<PendingApprovals>("/api/approvals/pending");

  useRealtimeEvent(RealtimeEvents.OrderStatus, () => {
    summary.refetch();
    costs.refetch();
  });
  useRealtimeEvent(RealtimeEvents.MachineStatus, () => output.refetch());
  useRealtimeEvent(RealtimeEvents.QcCompleted, () => defects.refetch());
  useRealtimeEvent(RealtimeEvents.NotificationNew, () => {
    alerts.refetch();
    approvals.refetch();
  });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Owner dashboard"
        subtitle="Any order, any roll, any rupee — live from the Everest mill floor."
        action={<MonthPicker month={month} onChange={setMonth} max={thisMonth} />}
      />

      {approvals.data && approvals.data.total > 0 && <ApprovalsWaiting data={approvals.data} />}
      {summary.error && <ErrorNote message={`Couldn't load the month summary: ${summary.error}`} onRetry={summary.refetch} />}
      {output.error && <ErrorNote message={`Couldn't load loom output: ${output.error}`} onRetry={output.refetch} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <OutputTile data={output.data} />
        <LoomsTile data={output.data} />
        <RevenueTile data={summary.data} />
        <ReceivablesTile data={summary.data} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <LoomFloor data={output.data} loading={output.loading} />
          <OrderMargins data={costs.data} loading={costs.loading} error={costs.error} retry={costs.refetch} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <QualityOutlier data={defects.data} loading={defects.loading} error={defects.error} />
          <AlertsPanel data={alerts.data} loading={alerts.loading} error={alerts.error} />
          <AssistantTerminal />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── building blocks ───────────────────────── */

type Tone = "green" | "amber" | "red" | "grey" | "brand";

const CHIP: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-800",
  grey: "bg-surface-container text-gray-600",
  brand: "bg-brand-soft text-brand",
};
const DOT: Record<Tone, string> = {
  green: "bg-emerald-600",
  amber: "bg-amber-500",
  red: "bg-red-600",
  grey: "bg-gray-400",
  brand: "bg-brand",
};

function Chip({ tone, dot, children, className = "" }: { tone: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={`label-caps-sm inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-1 ${CHIP[tone]} ${className}`}>
      {dot && <span className={`h-1.5 w-1.5 ${DOT[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  );
}

function machineTone(status: string): Tone {
  const c = statusColor[status.toLowerCase() as StatusColorKey];
  return c === "green" || c === "amber" || c === "red" ? c : "grey";
}

function Skeleton({ className }: { className: string }) {
  return <span className={`inline-block animate-pulse rounded-sm bg-surface-container ${className}`} aria-hidden="true" />;
}

function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-md border border-border/80 bg-white shadow-sm ${className}`}>{children}</section>;
}

function PanelTitle({ title, tag, action }: { title: string; tag?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-3 w-3 shrink-0 bg-brand" aria-hidden="true" />
        <h2 className="truncate text-[17px] font-semibold leading-6 text-foreground">{title}</h2>
        {tag}
      </div>
      {action}
    </div>
  );
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline">
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function Kpi({
  label,
  corner,
  children,
  footer,
}: {
  label: string;
  corner?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Panel className="flex flex-col justify-between p-4">
      <div>
        <div className="flex items-start justify-between gap-2 pb-1">
          <h2 className="label-caps max-w-[70%] text-gray-500">{label}</h2>
          {corner}
        </div>
        {children}
      </div>
      {footer && <div className="mt-3 bg-surface-low px-2.5 py-2 text-[11px] leading-4 text-gray-600">{footer}</div>}
    </Panel>
  );
}

function BigNumber({ value, unit, tone = "default" }: { value: ReactNode; unit?: ReactNode; tone?: "default" | "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-foreground";
  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
      <span className={`display-num text-[34px] leading-[44px] ${color}`}>{value}</span>
      {unit && <span className="text-sm font-semibold text-gray-500">{unit}</span>}
    </div>
  );
}

/** Total metres per day across all looms, oldest first. */
function dailyTotals(machines: MachineOutputRow[]) {
  const byDate = new Map<string, number>();
  for (const m of machines) for (const d of m.daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.qty);
  return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, qty]) => ({ date, qty }));
}

function Bars({ series, className = "h-8", highlightLast = true }: { series: { date: string; qty: number }[]; className?: string; highlightLast?: boolean }) {
  const peak = Math.max(1, ...series.map((d) => d.qty));
  return (
    <div className={`flex items-end gap-[3px] ${className}`}>
      {series.map((d, i) => (
        <div
          key={d.date}
          title={`${d.date}: ${num(d.qty)} m`}
          className={`flex-1 ${highlightLast && i === series.length - 1 ? "bg-brand" : "bg-brand-tint/35"}`}
          style={{ height: `${Math.max(d.qty > 0 ? 10 : 4, (d.qty / peak) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/* ───────────────────────── KPI tiles ───────────────────────── */

function OutputTile({ data }: { data: MachineOutput | null }) {
  const machines = data?.machines ?? [];
  const today = data?.totals.todayOutput ?? 0;
  const capacity = machines.reduce((s, m) => s + m.capacityMetresPerShift, 0) * SHIFTS_PER_DAY;
  const progress = capacity > 0 ? (today / capacity) * 100 : null;
  const series = dailyTotals(machines);
  const avg = series.length ? (data?.totals.periodOutput ?? 0) / series.length : 0;

  return (
    <Kpi
      label="Today's output"
      corner={<Ruler className="h-4 w-4 text-gray-400" aria-hidden="true" />}
      footer={
        data ? (
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span>
                7 days: <strong className="text-foreground">{num(data.totals.periodOutput)} m</strong>
              </span>
              <span>
                Avg <strong className="text-foreground">{num(avg)} m</strong> / day
              </span>
            </div>
            {series.length > 1 && <Bars series={series} className="h-7 w-24" />}
          </div>
        ) : undefined
      }
    >
      <BigNumber value={data ? num(today) : <Skeleton className="h-9 w-32" />} unit="metres" />
      <div className="mt-2.5">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-gray-500">Rated capacity: {capacity ? `${num(capacity)} m/day` : "—"}</span>
          <span className="font-semibold text-brand">{pct(progress)}</span>
        </div>
        <div className="h-2 w-full overflow-hidden bg-surface-container">
          <div className="h-full bg-gradient-to-r from-brand to-brand-tint transition-[width] duration-700" style={{ width: `${Math.min(100, progress ?? 0)}%` }} />
        </div>
      </div>
    </Kpi>
  );
}

function LoomsTile({ data }: { data: MachineOutput | null }) {
  const machines = data?.machines ?? [];
  const by = (s: string) => machines.filter((m) => m.status.toLowerCase() === s).length;
  const running = by("running");
  const idle = by("idle");
  const down = by("breakdown") + by("maintenance");
  // Utilisation above 100% means a log or a rated capacity is off (the
  // floor board flags those looms), so it never feeds the shed average.
  const utils = machines.map((m) => m.utilisationPct).filter((u): u is number => u != null && u <= 100);
  const avgUtil = utils.length ? utils.reduce((s, u) => s + u, 0) / utils.length : null;
  const attention = machines.filter((m) => m.status.toLowerCase() !== "running").slice(0, 2);

  return (
    <Kpi
      label="Active looms availability"
      corner={avgUtil != null ? <Chip tone={avgUtil >= 75 ? "green" : "amber"}>{pct(avgUtil, 0)} util · 7d</Chip> : undefined}
      footer={
        data ? (
          attention.length === 0 ? (
            <span className="flex items-center gap-1 font-semibold text-emerald-700">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Every loom is running
            </span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {attention.map((m) => (
                <li key={m.machineId} className={`flex justify-between gap-2 font-medium ${machineTone(m.status) === "red" ? "text-red-700" : "text-amber-800"}`}>
                  <span className="truncate">{m.name}</span>
                  <span className="capitalize">{m.status.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )
        ) : undefined
      }
    >
      <BigNumber
        value={
          data ? (
            <>
              {running} <span className="font-display text-xl font-normal text-gray-400">/ {machines.length}</span>
            </>
          ) : (
            <Skeleton className="h-9 w-24" />
          )
        }
        unit={machines.length ? <span className="text-emerald-700">{pct((running / machines.length) * 100, 0)} running</span> : undefined}
      />
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Chip tone="green" dot>{running} running</Chip>
        {idle > 0 && <Chip tone="amber" dot>{idle} idle</Chip>}
        {down > 0 && <Chip tone="red" dot>{down} down</Chip>}
      </div>
    </Kpi>
  );
}

function RevenueTile({ data }: { data: MonthSummary | null }) {
  const p = data?.pnl;
  return (
    <Kpi
      label={`Revenue booked${data ? ` · ${data.label}` : ""}`}
      corner={
        p && p.marginPct != null ? (
          <Chip tone={p.marginPct < 0 ? "red" : "green"}>
            {p.marginPct < 0 ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
            {pct(p.marginPct)} margin
          </Chip>
        ) : undefined
      }
      footer={
        data ? (
          <div className="flex justify-between gap-2">
            <span>
              Orders booked: <strong className="text-foreground">{data.pnl.ordersRealised}</strong>
            </span>
            <span>
              WIP: <strong className="text-foreground">{data.workInProgress.orders}</strong> · {inrShort(data.workInProgress.costToDate)}
            </span>
          </div>
        ) : undefined
      }
    >
      <BigNumber value={p ? inrShort(p.revenue) : <Skeleton className="h-9 w-36" />} unit="ex-GST" />
      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div className="flex flex-col">
          <span className="label-caps-sm text-gray-500">Net profit</span>
          <span className={`text-[13px] font-semibold tabular-nums ${p && p.netProfit < 0 ? "text-red-700" : "text-foreground"}`}>
            {p ? inrShort(p.netProfit) : "—"}
          </span>
        </div>
        <div className="flex flex-col text-right">
          <span className="label-caps-sm text-gray-500">GST invoiced</span>
          <span className="text-[13px] font-semibold tabular-nums text-foreground">{data ? inrShort(data.cash.gstInvoiced) : "—"}</span>
        </div>
      </div>
    </Kpi>
  );
}

function ReceivablesTile({ data }: { data: MonthSummary | null }) {
  const r = data?.receivables;
  return (
    <Kpi
      label="Pending receivables"
      corner={<Landmark className="h-4 w-4 text-gray-400" aria-hidden="true" />}
      footer={
        data ? (
          <div className="flex justify-between gap-2">
            <span>Collected this month</span>
            <strong className="text-emerald-700">
              {inrShort(data.cash.paymentsReceived)} <span className="font-medium text-gray-500">· {data.cash.paymentsCount} pmt</span>
            </strong>
          </div>
        ) : undefined
      }
    >
      <BigNumber value={r ? inrShort(r.outstanding) : <Skeleton className="h-9 w-32" />} unit="outstanding" tone={r && r.outstanding > 0 ? "default" : "good"} />
      {r && r.invoicesOpen > 0 ? (
        <Link
          href="/accounts/payments"
          className="mt-2.5 flex items-center justify-between gap-2 border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 transition-colors hover:bg-amber-100"
        >
          <span className="flex items-center gap-1.5">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            {r.invoicesOpen} open invoice{r.invoicesOpen === 1 ? "" : "s"} to collect
          </span>
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        r && <p className="mt-2.5 text-[11px] font-semibold text-emerald-700">All invoices settled</p>
      )}
    </Kpi>
  );
}

/* ───────────────────────── loom shed ───────────────────────── */

const FLOOR_FILTERS = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "idle", label: "Idle" },
  { key: "down", label: "Breakdown" },
] as const;
type FloorFilter = (typeof FLOOR_FILTERS)[number]["key"];

function floorBucket(status: string): Exclude<FloorFilter, "all"> {
  const s = status.toLowerCase();
  return s === "running" ? "running" : s === "idle" ? "idle" : "down";
}

function LoomFloor({ data, loading }: { data: MachineOutput | null; loading: boolean }) {
  const [filter, setFilter] = useState<FloorFilter>("all");
  const live = useRealtimeConnected();
  const machines = data?.machines ?? [];
  const shown = filter === "all" ? machines : machines.filter((m) => floorBucket(m.status) === filter);
  const count = (f: FloorFilter) => (f === "all" ? machines.length : machines.filter((m) => floorBucket(m.status) === f).length);
  const capacityPerShift = machines.reduce((s, m) => s + m.capacityMetresPerShift, 0);
  const peak = Math.max(1, ...machines.flatMap((m) => m.daily.map((d) => d.qty)));

  return (
    <Panel className="p-4">
      <PanelTitle
        title="Live Loom Shed Telemetry"
        tag={<Chip tone="grey">Unit-1 shed</Chip>}
        action={<PanelLink href="/production/floor-board">Floor board</PanelLink>}
      />

      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter looms">
        <div className="flex flex-wrap bg-surface-low p-0.5">
          {FLOOR_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f.key ? "bg-white font-semibold text-brand shadow-sm" : "text-gray-600 hover:text-foreground"
              }`}
            >
              {f.label} <span className="tabular-nums text-gray-400">({count(f.key)})</span>
            </button>
          ))}
        </div>
        <span className={`ml-auto inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium ${live ? "bg-emerald-50 text-emerald-800" : "bg-surface-low text-gray-500"}`}>
          <span className={`h-1.5 w-1.5 ${live ? "animate-pulse bg-emerald-600" : "bg-gray-400"}`} aria-hidden="true" />
          {live ? "Live · status push" : "Reconnecting"}
        </span>
      </div>

      {loading && !data && <Loading label="Reading the loom shed…" />}
      {data && machines.length === 0 && (
        <p className="mt-3 border border-dashed border-border-strong bg-surface-low px-3 py-8 text-center text-[13px] text-gray-500">
          No looms registered yet. Machines appear here once Production adds them.
        </p>
      )}
      {shown.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
          {shown.map((m) => (
            <LoomTile key={m.machineId} m={m} peak={peak} />
          ))}
        </ul>
      )}
      {data && machines.length > 0 && shown.length === 0 && (
        <p className="mt-3 bg-surface-low px-3 py-6 text-center text-[13px] text-gray-500">No looms in this state right now.</p>
      )}

      {data && machines.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 bg-surface-low px-3 py-2 text-xs text-gray-600">
          <span>
            Shed output today: <strong className="text-[13px] text-foreground">{num(data.totals.todayOutput)} m</strong>
          </span>
          <span>
            Rated capacity: <strong className="text-[13px] text-foreground">{num(capacityPerShift)} m/shift</strong>
          </span>
          <span className="flex items-center gap-1">
            <Gauge className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
            7-day output: <strong className="text-[13px] text-emerald-700">{num(data.totals.periodOutput)} m</strong>
          </span>
        </div>
      )}
    </Panel>
  );
}

function LoomTile({ m, peak }: { m: MachineOutputRow; peak: number }) {
  const tone = machineTone(m.status);
  const down = tone === "red";
  const idle = tone === "amber";
  const shell = down ? "bg-red-50/80 ring-1 ring-inset ring-red-200" : idle ? "bg-amber-50/80 ring-1 ring-inset ring-amber-200" : "bg-surface-low hover:bg-surface-container/70";
  const over = m.utilisationPct != null && m.utilisationPct > 100;

  return (
    <li className={`relative flex flex-col gap-1 p-2.5 transition-colors ${shell}`}>
      <div className="flex items-start justify-between gap-1">
        <span className={`truncate font-display text-[15px] font-semibold ${down ? "text-red-700" : idle ? "text-amber-800" : "text-foreground"}`} title={m.name}>
          {m.name}
        </span>
        {down ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center bg-red-700 text-xs font-bold text-white" title={m.status}>
            !
          </span>
        ) : (
          <span className={`mt-1 h-2.5 w-2.5 shrink-0 ${DOT[tone]}`} title={m.status} aria-hidden="true" />
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className={`font-display text-lg font-semibold tabular-nums ${down ? "text-red-700" : "text-foreground"}`}>{num(m.todayOutput)}</span>
        <span className="text-[11px] text-gray-500">m today</span>
      </div>
      <span className={`label-caps-sm truncate ${down ? "text-red-700" : idle ? "text-amber-800" : "text-gray-500"}`}>
        {m.status.toLowerCase()} · {m.type}
      </span>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className={`text-[11px] font-semibold tabular-nums ${over ? "text-amber-700" : down ? "text-red-700" : "text-emerald-700"}`} title={`${m.shiftsLogged} shift(s) logged in 7 days`}>
          {over ? "over rated" : m.utilisationPct == null ? "no shift logged" : `${pct(m.utilisationPct, 0)} util`}
        </span>
        <div className="flex h-4 w-14 items-end gap-px" aria-label={`Daily output for ${m.name}`}>
          {m.daily.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${num(d.qty)} m`}
              className={`flex-1 ${down ? "bg-red-300" : "bg-brand-tint/45"}`}
              style={{ height: `${Math.max(d.qty > 0 ? 15 : 6, (d.qty / peak) * 100)}%` }}
            />
          ))}
        </div>
      </div>
    </li>
  );
}

/* ───────────────────────── order margins ───────────────────────── */

function costLine(o: OrderCosting) {
  const c = o.costs;
  const parts: [string, number][] = [
    ["Yarn", c.yarn + c.processWastage],
    ["Wage", c.directWages + c.indirectLabour],
    ["Pwr", c.power],
    ["OH", c.overhead + c.directExpenses],
  ];
  return parts.filter(([, v]) => v > 0).map(([k, v]) => `${k} ${inrShort(v).replace("₹", "")}`).join(" + ");
}

function toCsv(rows: OrderCosting[]) {
  const head = ["Order", "Buyer", "Fabric", "Metres", "Yarn", "Wages", "Power", "Overhead", "Total cost", "Revenue", "Profit", "Margin %", "Stage"];
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = rows.map((o) =>
    [
      o.orderNo,
      o.buyerName,
      o.fabric,
      o.qtyMetres,
      Math.round(o.costs.yarn + o.costs.processWastage),
      Math.round(o.costs.directWages + o.costs.indirectLabour),
      Math.round(o.costs.power),
      Math.round(o.costs.overhead + o.costs.directExpenses),
      Math.round(o.totalCost),
      Math.round(o.revenue),
      Math.round(o.profit),
      o.marginPct == null ? "" : o.marginPct.toFixed(1),
      o.stage,
    ]
      .map(esc)
      .join(","),
  );
  return [head.map(esc).join(","), ...lines].join("\n");
}

type MarginView = { final: boolean; margin: number | null; tone: Tone; bar: string; text: string };

function marginView(o: OrderCosting): MarginView {
  const final = o.stage === "final";
  // Work in progress has only part of its cost logged, so its "margin" would
  // flatter it; margins show once an order is booked.
  const margin = final ? o.marginPct : null;
  const tone: Tone = margin == null ? "grey" : margin < 0 ? "red" : margin < 10 ? "amber" : "green";
  const bar = { red: "bg-red-600", amber: "bg-amber-500", green: "bg-emerald-600", grey: "bg-gray-300", brand: "bg-brand" }[tone];
  const text = { red: "text-red-700", amber: "text-amber-700", green: "text-emerald-700", grey: "text-gray-500", brand: "text-brand" }[tone];
  return { final, margin, tone, bar, text };
}

/** A 40% margin fills the bar; a loss fills it red by the size of the loss. */
function MarginBar({ v }: { v: MarginView }) {
  const width = Math.min(100, Math.abs(v.margin ?? 0) * 2.5);
  return (
    <div className="mt-1.5 h-1.5 w-full bg-surface-container">
      <div className={`h-full ${v.bar}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function OrderMargins({ data, loading, error, retry }: { data: Costs | null; loading: boolean; error: string | null; retry: () => void }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const all = [...(data?.realised ?? []), ...(data?.inProgress ?? [])];
    const q = query.trim().toLowerCase();
    return q ? all.filter((o) => `${o.orderNo} ${o.buyerName} ${o.fabric}`.toLowerCase().includes(q)) : all;
  }, [data, query]);

  const booked = rows.filter((o) => o.stage === "final");
  const totals = {
    metres: rows.reduce((s, o) => s + o.qtyMetres, 0),
    cost: rows.reduce((s, o) => s + o.totalCost, 0),
    revenue: rows.reduce((s, o) => s + o.revenue, 0),
    margin: (() => {
      const rev = booked.reduce((s, o) => s + o.revenue, 0);
      return rev > 0 ? (booked.reduce((s, o) => s + o.profit, 0) / rev) * 100 : null;
    })(),
  };

  function exportCsv() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "order-margins.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel className="p-4">
      <PanelTitle title="Order Profitability & Direct Margins" action={<PanelLink href="/accounts/costing">Cost breakdown</PanelLink>} />
      <p className="mt-1 text-[13px] text-gray-500">Yarn, floor wages, power and mill overheads allocated to every order this month.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Filter orders</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter buyer / order no…"
            className="w-full border border-border-strong/70 bg-surface-low py-1.5 pl-8 pr-2 text-[13px] outline-none transition-colors placeholder:text-gray-400 focus:border-brand-tint focus:bg-white focus:ring-2 focus:ring-brand-tint/20"
          />
        </label>
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1.5 border border-border-strong/70 bg-white px-2.5 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-surface-low disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export CSV
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote message={`Couldn't load order costs: ${error}`} onRetry={retry} />
        </div>
      )}
      {loading && !data && <Loading label="Costing orders…" />}
      {data && rows.length === 0 && (
        <p className="mt-3 border border-dashed border-border-strong bg-surface-low px-3 py-8 text-center text-[13px] text-gray-500">
          {query ? "No order matches that filter." : "No orders costed this month yet. Profit appears once orders are produced and invoiced."}
        </p>
      )}

      {rows.length > 0 && (
        <>
          {/* Phones: one card per order. */}
          <ul className="mt-3 flex flex-col gap-2 md:hidden">
            {rows.map((o) => {
              const v = marginView(o);
              return (
                <li key={o.orderId} className="bg-surface-low p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/orders/${o.orderId}`} className="font-display font-semibold text-brand hover:underline">
                        {o.orderNo}
                      </Link>
                      <p className="truncate text-[13px] text-gray-600">{o.buyerName}</p>
                    </div>
                    <div className={`shrink-0 text-right font-display text-base font-semibold tabular-nums ${v.text}`}>
                      {v.final ? pct(v.margin) : "—"}
                      <p className="label-caps-sm text-gray-500">{v.final ? "margin" : "not booked"}</p>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-600">
                    {o.fabric} · {num(o.qtyMetres)} m
                  </p>
                  <MarginBar v={v} />
                  <div className="mt-2 flex justify-between gap-2 text-xs">
                    <span className="text-gray-500">
                      Cost{v.final ? "" : " to date"} <strong className="text-foreground">{inr(o.totalCost)}</strong>
                    </span>
                    <span className="text-gray-500">
                      Revenue <strong className="text-foreground">{inr(o.revenue)}</strong>
                    </span>
                  </div>
                </li>
              );
            })}
            <li className="flex items-center justify-between gap-2 border-t-2 border-brand bg-white px-3 py-2.5 text-xs">
              <span className="label-caps text-gray-600">
                {rows.length} order{rows.length === 1 ? "" : "s"}
              </span>
              <span className="text-gray-500">
                Revenue <strong className="text-brand">{inr(totals.revenue)}</strong> ·{" "}
                <strong className={totals.margin != null && totals.margin < 0 ? "text-red-700" : "text-emerald-700"}>{pct(totals.margin)}</strong> booked avg
              </span>
            </li>
          </ul>

          {/* Tablet and up: the full ledger. */}
          <div className="scrollbar-thin -mx-4 mt-3 hidden overflow-x-auto px-4 md:block">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="bg-surface-low text-left text-gray-600">
                  <th className="label-caps px-3 py-2.5">Order / buyer</th>
                  <th className="label-caps px-3 py-2.5">Fabric</th>
                  <th className="label-caps px-3 py-2.5 text-right">Volume</th>
                  <th className="label-caps px-3 py-2.5">Direct cost</th>
                  <th className="label-caps px-3 py-2.5 text-right">Revenue</th>
                  <th className="label-caps px-3 py-2.5 text-right">Net margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((o) => {
                  const v = marginView(o);
                  return (
                    <tr key={o.orderId} className={`align-top transition-colors hover:bg-brand-soft/25 ${v.tone === "red" || v.tone === "amber" ? "bg-amber-50/30" : ""}`}>
                      <td className="px-3 py-3">
                        <Link href={`/orders/${o.orderId}`} className="font-display font-semibold text-brand hover:underline">
                          {o.orderNo}
                        </Link>
                        <div className="text-gray-600">{o.buyerName}</div>
                      </td>
                      <td className="max-w-48 px-3 py-3">
                        <div className="font-medium text-foreground">{o.fabric}</div>
                        <span className={`label-caps-sm mt-0.5 inline-block px-1 py-0.5 ${v.final ? "bg-emerald-50 text-emerald-800" : "bg-brand-soft text-brand"}`}>
                          {v.final ? "Booked" : "In progress"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-foreground">{num(o.qtyMetres)} m</td>
                      <td className="px-3 py-3">
                        <div className="font-semibold tabular-nums text-foreground">
                          {inr(o.totalCost)}
                          {!v.final && <span className="ml-1 text-[11px] font-normal text-gray-500">to date</span>}
                        </div>
                        <div className="max-w-56 text-[11px] leading-4 text-gray-500">{costLine(o) || "No cost logged yet"}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-foreground">{inr(o.revenue)}</td>
                      <td className="w-32 px-3 py-3 text-right">
                        <div className={`flex items-center justify-end gap-1 font-display text-[15px] font-semibold tabular-nums ${v.text}`}>
                          {v.margin != null && v.margin < 10 && <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                          {v.final ? pct(v.margin) : "—"}
                        </div>
                        <MarginBar v={v} />
                        {!v.final && <div className="mt-1 text-[10px] text-gray-400">not booked yet</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-surface-low font-semibold text-foreground">
                  <td className="label-caps px-3 py-3" colSpan={2}>
                    {rows.length} order{rows.length === 1 ? "" : "s"} · aggregate
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{num(totals.metres)} m</td>
                  <td className="whitespace-nowrap px-3 py-3 tabular-nums">{inr(totals.cost)}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-brand">{inr(totals.revenue)}</td>
                  <td className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${totals.margin != null && totals.margin < 0 ? "text-red-700" : "text-emerald-700"}`}>
                    {pct(totals.margin)} <span className="block text-[10px] font-medium text-gray-500">booked avg</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ───────────────────────── right rail ───────────────────────── */

const DEFECT_LABEL: Record<string, string> = {
  hole: "Holes",
  colour_mismatch: "Colour mismatch",
  uneven_weave: "Uneven weave",
};

function QualityOutlier({ data, loading, error }: { data: DefectsResponse | null; loading: boolean; error: string | null }) {
  const worst = data?.byMachine.find((m) => m.reject > 0);
  const topDefect = worst ? Object.entries(worst.defects).sort(([, a], [, b]) => b - a)[0] : undefined;
  const critical = worst ? worst.shareOfTotalRejects >= 50 : false;

  return (
    <Panel className="p-4">
      {error && <ErrorNote message={`Couldn't load defect analytics: ${error}`} />}
      {loading && !data && <Loading label="Checking QC records…" />}
      {data && !worst && (
        <div className="flex flex-col gap-2">
          <Chip tone="green" dot className="self-start">
            Quality steady
          </Chip>
          <p className="font-display text-[17px] font-semibold leading-6 text-foreground">
            {data.summary.totalInspected === 0 ? "No rolls inspected in the last 30 days" : "No rejected rolls in the last 30 days"}
          </p>
          <p className="text-[13px] text-gray-500">{num(data.summary.totalInspected)} rolls inspected across the shed.</p>
          <PanelLink href="/quality/defects">Defect analytics</PanelLink>
        </div>
      )}
      {data && worst && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Chip tone="red">
              <TriangleAlert className="h-3 w-3" aria-hidden="true" /> Quality outlier detected
            </Chip>
            <span className={`label-caps-sm ${critical ? "text-red-700" : "text-amber-700"}`}>{critical ? "Critical" : "Watch"}</span>
          </div>
          <p className="font-display text-[17px] font-semibold leading-6 text-foreground">
            {worst.name}: responsible for {pct(worst.shareOfTotalRejects, 0)} of rejected rolls (30 days)
          </p>
          <div className="flex flex-col gap-1 bg-red-50/70 p-2.5 text-[13px]">
            {topDefect && (
              <div className="flex justify-between gap-2 font-medium text-red-800">
                <span>Defect signature</span>
                <span className="text-right">{DEFECT_LABEL[topDefect[0]] ?? topDefect[0]}</span>
              </div>
            )}
            <div className="flex justify-between gap-2 text-gray-700">
              <span>{worst.name} reject rate</span>
              <strong className="font-display text-red-700">{pct(worst.rejectRate)}</strong>
            </div>
            <div className="flex justify-between gap-2 text-[11px] text-gray-500">
              <span>Shed-wide reject rate</span>
              <span className="text-[13px] font-medium text-gray-700">{pct(data.summary.rejectRate)}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-surface-low p-2.5">
              <p className="label-caps-sm text-gray-500">Rejected rolls</p>
              <p className="font-display text-base font-semibold text-red-700">
                {worst.reject} <span className="text-xs font-normal text-gray-500">of {worst.total}</span>
              </p>
            </div>
            <div className="bg-surface-low p-2.5">
              <p className="label-caps-sm text-gray-500">Shed inspected</p>
              <p className="font-display text-base font-semibold text-foreground">{num(data.summary.totalInspected)}</p>
            </div>
          </div>
          <Link
            href="/quality/defects"
            className="flex items-center justify-center gap-2 bg-brand py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-container"
          >
            <Factory className="h-4 w-4" aria-hidden="true" /> Inspect defect analytics
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/quality/qc" className="bg-surface-container py-1.5 text-center text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200">
              QC queue
            </Link>
            <Link href="/production/machines" className="bg-red-50 py-1.5 text-center text-xs font-semibold text-red-700 transition-colors hover:bg-red-100">
              Machine status
            </Link>
          </div>
          {data.callouts.length > 1 && (
            <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
              {data.callouts.slice(1, 3).map((c) => (
                <li key={c} className="flex gap-2 text-xs text-gray-600">
                  <span className="mt-1.5 h-1 w-1 shrink-0 bg-amber-500" aria-hidden="true" />
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function AlertsPanel({ data, loading, error }: { data: { notifications: NotificationRow[]; unreadCount: number } | null; loading: boolean; error: string | null }) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label-caps inline-flex items-center gap-1.5 bg-emerald-50 px-2 py-1 text-emerald-800">
          <Siren className="h-3.5 w-3.5" aria-hidden="true" />
          Mill alerts{data ? ` · ${data.unreadCount} unread` : ""}
        </span>
        <PanelLink href="/alerts">All</PanelLink>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote message={`Couldn't load alerts: ${error}`} />
        </div>
      )}
      {loading && !data && <Loading />}
      {data && data.notifications.length === 0 && (
        <div className="mt-3 flex items-center gap-2 bg-surface-low px-3 py-4 text-[13px] text-gray-600">
          <CircleCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" /> You&apos;re all caught up.
        </div>
      )}
      {data && data.notifications.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 bg-surface-low p-2.5">
          {data.notifications.map((n) => (
            <li key={n.id} className="bg-white p-2.5 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <span className={`label-caps-sm border px-1.5 py-0.5 ${statusBadgeClass(severityStatus(n.severity))}`}>{alertKindLabel(n.type)}</span>
                <span className="text-[11px] text-gray-400">{formatAlertTime(n.createdAt)}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-5 text-gray-700">{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AssistantTerminal() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (question: string) => {
    const text = question.trim();
    if (text) router.push(`/assistant?q=${encodeURIComponent(text)}`);
  };

  return (
    <Panel className="p-4">
      <div className="flex items-center gap-2">
        <Bot className="h-5 w-5 text-brand" aria-hidden="true" />
        <h2 className="text-[17px] font-semibold text-foreground">Mill AI Query Terminal</h2>
      </div>
      <form
        className="mt-3 flex border border-border-strong/70 bg-surface-low focus-within:border-brand-tint focus-within:ring-2 focus-within:ring-brand-tint/20"
        onSubmit={(e) => {
          e.preventDefault();
          go(q);
        }}
      >
        <label htmlFor="dash-ask" className="sr-only">
          Ask the mill
        </label>
        <input
          id="dash-ask"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Which buyer has the lowest margin?"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-gray-400"
        />
        <button type="submit" aria-label="Ask" className="flex w-10 items-center justify-center bg-brand text-white transition-colors hover:bg-brand-container">
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.slice(0, 3).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => go(s)}
            className="bg-surface-container px-2 py-1 text-left text-[11px] font-medium text-gray-700 transition-colors hover:bg-brand-soft hover:text-brand"
          >
            {s}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 bg-surface-low px-2.5 py-2 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 bg-emerald-600" aria-hidden="true" /> Local model · read-only ERP queries
        </span>
        <span className="font-semibold text-gray-700">Ollama</span>
      </div>
    </Panel>
  );
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
      className="group flex flex-wrap items-center justify-between gap-2 border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 shadow-xs transition-colors hover:bg-amber-100"
    >
      <span className="flex items-center gap-2">
        <TriangleAlert className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <span>
          <span className="font-semibold">
            {data.total} approval{data.total === 1 ? "" : "s"} waiting for you
          </span>{" "}
          · {parts.join(", ")}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 text-xs font-semibold">
        Review <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
