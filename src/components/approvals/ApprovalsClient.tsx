"use client";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Table } from "@/components/ui";
import { useApi, postJson } from "@/lib/useApi";
import { dateIN, inr } from "@/lib/accounts/format";
import { currentMonthKey, monthLabel } from "@/lib/accounts/period";
import { MonthPicker } from "@/components/accounts/MonthPicker";
import { ErrorNote, Loading } from "@/components/accounts/Stat";

// HARDENING_ADDENDUM.md item 4: a shared queue so the owner sees "you have N
// pending approvals" across all three request types in one place — each
// still raised contextually (Inventory's low-stock card, Machines on a
// BREAKDOWN) rather than from here.

interface PurchaseRequestRow {
  id: string;
  qtyKg: number;
  status: string;
  note: string | null;
  createdAt: string;
  approvedAt: string | null;
  yarnType: { name: string; colour: string };
}
interface MaintenanceRequestRow {
  id: string;
  description: string;
  status: string;
  cost: number | null;
  createdAt: string;
  approvedAt: string | null;
  machine: { name: string; type: string; status: string };
}
interface PayoutApprovalRow {
  id: string;
  month: string;
  totalWages: number;
  status: string;
  createdAt: string;
  approvedAt: string | null;
}

type Tab = "purchase" | "maintenance" | "payouts";

export function ApprovalsClient() {
  const [tab, setTab] = useState<Tab>("purchase");
  const purchase = useApi<{ requests: PurchaseRequestRow[]; canApprove: boolean }>("/api/purchase-requests");
  const maintenance = useApi<{ requests: MaintenanceRequestRow[]; canApprove: boolean }>("/api/maintenance-requests");
  const payouts = useApi<{ requests: PayoutApprovalRow[]; canApprove: boolean }>("/api/payout-approvals");

  const pending = (rows?: { status: string }[]) => rows?.filter((r) => r.status === "PENDING").length ?? 0;
  const pendingBy: Record<Tab, number> = {
    purchase: pending(purchase.data?.requests),
    maintenance: pending(maintenance.data?.requests),
    payouts: pending(payouts.data?.requests),
  };
  const pendingCount = pendingBy.purchase + pendingBy.maintenance + pendingBy.payouts;

  const tabs: { id: Tab; label: string }[] = [
    { id: "purchase", label: "Purchase requests" },
    { id: "maintenance", label: "Maintenance" },
    { id: "payouts", label: "Payouts" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Approvals</h1>
        <p className="text-sm text-gray-500">
          {pendingCount > 0 ? `${pendingCount} pending across all queues.` : "Nothing pending."}
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${tab === t.id ? "border-b-2 border-brand text-brand" : "text-gray-500"}`}
          >
            {t.label}
            {pendingBy[t.id] > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">{pendingBy[t.id]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "purchase" && <PurchaseRequestsTab data={purchase.data} loading={purchase.loading} error={purchase.error} refetch={purchase.refetch} />}
      {tab === "maintenance" && <MaintenanceTab data={maintenance.data} loading={maintenance.loading} error={maintenance.error} refetch={maintenance.refetch} />}
      {tab === "payouts" && <PayoutsTab data={payouts.data} loading={payouts.loading} error={payouts.error} refetch={payouts.refetch} />}
    </div>
  );
}

function messageOf(result: { fieldErrors?: Record<string, string[]>; error?: string }, fallback: string) {
  return Object.values(result.fieldErrors ?? {}).flat().join(" ") || result.error || fallback;
}

const decidedOn = (r: { status: string; approvedAt: string | null }) =>
  r.status === "PENDING" || !r.approvedAt ? "—" : dateIN(r.approvedAt);

/** Approve / Reject for one PENDING request. Disabled while a decision is in
 * flight (so a double-click can't send two), shows the server's reason when
 * it refuses (already decided elsewhere, total changed), and refreshes the
 * list either way. */
function Decision({
  path,
  onDone,
  withCost = false,
  confirmApprove,
}: {
  path: string;
  onDone: () => void;
  withCost?: boolean;
  confirmApprove?: string;
}) {
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState("");

  async function decide(status: "APPROVED" | "REJECTED") {
    if (status === "APPROVED" && confirmApprove && !window.confirm(confirmApprove)) return;
    setBusy(status);
    setError(null);
    const extra = withCost && status === "APPROVED" && cost.trim() !== "" ? { cost: Number(cost) } : {};
    const result = await postJson(path, { status, ...extra }, "PATCH");
    setBusy(null);
    if (!result.ok) setError(messageOf(result, "Couldn't save the decision"));
    onDone();
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {withCost && (
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Est. cost ₹"
            aria-label="Estimated repair cost in rupees (optional)"
            className="w-28 rounded-md border border-border px-2 py-1 text-sm"
          />
        )}
        <Button size="sm" disabled={busy !== null} onClick={() => decide("APPROVED")}>
          {busy === "APPROVED" ? "Approving…" : "Approve"}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => decide("REJECTED")}>
          {busy === "REJECTED" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
      {error && <p role="alert" className="max-w-xs text-xs text-red-700">{error}</p>}
    </div>
  );
}

function PurchaseRequestsTab({
  data, loading, error, refetch,
}: {
  data?: { requests: PurchaseRequestRow[]; canApprove: boolean } | null;
  loading: boolean; error: string | null; refetch: () => void;
}) {
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={`Couldn't load purchase requests: ${error}`} onRetry={refetch} />;
  if (!data) return null;
  return (
    <Card>
      <CardHeader title="Yarn purchase requests" />
      <Table
        columns={[
          { header: "Yarn", render: (r: PurchaseRequestRow) => `${r.yarnType.name} (${r.yarnType.colour})` },
          { header: "Qty", className: "text-right tabular-nums", render: (r) => `${r.qtyKg} kg` },
          { header: "Note", render: (r) => r.note ?? "—" },
          { header: "Raised", render: (r) => dateIN(r.createdAt) },
          { header: "Status", render: (r) => <Badge status={r.status} /> },
          { header: "Decided", render: decidedOn },
          { header: "", render: (r) =>
              data.canApprove && r.status === "PENDING" ? (
                <Decision path={`/api/purchase-requests/${r.id}`} onDone={refetch} />
              ) : null,
          },
        ]}
        rows={data.requests}
        keyFor={(r) => r.id}
        emptyState={<EmptyState title="No purchase requests" description="Raised from Inventory's low-stock card." />}
      />
    </Card>
  );
}

function MaintenanceTab({
  data, loading, error, refetch,
}: {
  data?: { requests: MaintenanceRequestRow[]; canApprove: boolean } | null;
  loading: boolean; error: string | null; refetch: () => void;
}) {
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={`Couldn't load maintenance requests: ${error}`} onRetry={refetch} />;
  if (!data) return null;
  return (
    <Card>
      <CardHeader title="Machine maintenance requests" />
      <Table
        columns={[
          { header: "Machine", render: (r: MaintenanceRequestRow) => `${r.machine.name} (${r.machine.type})` },
          { header: "Issue", render: (r) => r.description },
          { header: "Cost", className: "text-right tabular-nums", render: (r) => (r.cost != null ? inr(r.cost) : "—") },
          { header: "Raised", render: (r) => dateIN(r.createdAt) },
          { header: "Status", render: (r) => <Badge status={r.status} /> },
          { header: "Decided", render: decidedOn },
          { header: "", render: (r) =>
              data.canApprove && r.status === "PENDING" ? (
                <Decision path={`/api/maintenance-requests/${r.id}`} onDone={refetch} withCost />
              ) : null,
          },
        ]}
        rows={data.requests}
        keyFor={(r) => r.id}
        emptyState={<EmptyState title="No maintenance requests" description="Raised from Production → Machines on a BREAKDOWN." />}
      />
    </Card>
  );
}

function PayoutsTab({
  data, loading, error, refetch,
}: {
  data?: { requests: PayoutApprovalRow[]; canApprove: boolean } | null;
  loading: boolean; error: string | null; refetch: () => void;
}) {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [raising, setRaising] = useState(false);
  const [raiseError, setRaiseError] = useState<string | null>(null);

  async function raise() {
    setRaising(true);
    setRaiseError(null);
    const result = await postJson("/api/payout-approvals", { month });
    setRaising(false);
    if (!result.ok) {
      setRaiseError(messageOf(result, "Could not raise payout approval"));
      return;
    }
    refetch();
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={`Couldn't load payout approvals: ${error}`} onRetry={refetch} />;
  if (!data) return null;

  // A rejected month can be raised again (with its current wage total).
  const alreadyRaised = data.requests.some((r) => r.month === month && r.status !== "REJECTED");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Flag a month's wages for payout" />
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker month={month} onChange={(m) => { setMonth(m); setRaiseError(null); }} max={thisMonth} />
          <Button size="sm" onClick={raise} disabled={raising || alreadyRaised}>
            {alreadyRaised ? "Already raised" : raising ? "Raising…" : `Request approval for ${monthLabel(month)}`}
          </Button>
        </div>
        {raiseError && <p className="mt-2 text-sm text-red-700">{raiseError}</p>}
        <p className="mt-2 text-xs text-gray-500">
          Approving records the month&apos;s accrued wages as a &quot;wages&quot; expense dated the day you approve, with its ledger entry. If attendance changes before you approve, the total is refreshed and you approve the new figure.
        </p>
      </Card>

      <Card>
        <CardHeader title="Payout approvals" />
        <Table
          columns={[
            { header: "Month", render: (r: PayoutApprovalRow) => monthLabel(r.month) },
            { header: "Wages", className: "text-right tabular-nums", render: (r) => inr(r.totalWages) },
            { header: "Raised", render: (r) => dateIN(r.createdAt) },
            { header: "Status", render: (r) => <Badge status={r.status} /> },
            { header: "Decided", render: decidedOn },
            { header: "", render: (r) =>
                data.canApprove && r.status === "PENDING" ? (
                  <Decision
                    path={`/api/payout-approvals/${r.id}`}
                    onDone={refetch}
                    confirmApprove={`Release ${inr(r.totalWages, { decimals: true })} of wages for ${monthLabel(r.month)}? This records a wages expense dated today.`}
                  />
                ) : null,
            },
          ]}
          rows={data.requests}
          keyFor={(r) => r.id}
          emptyState={<EmptyState title="No payout approvals yet" description="Raise one above for a month, then approve it to record the wage payout." />}
        />
      </Card>
    </div>
  );
}
