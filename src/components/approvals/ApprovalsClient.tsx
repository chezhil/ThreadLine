"use client";
import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState, Table } from "@/components/ui";
import { useApi, postJson } from "@/lib/useApi";
import { inr } from "@/lib/accounts/format";
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
  yarnType: { name: string; colour: string };
}
interface MaintenanceRequestRow {
  id: string;
  description: string;
  status: string;
  cost: number | null;
  createdAt: string;
  machine: { name: string; type: string; status: string };
}
interface PayoutApprovalRow {
  id: string;
  month: string;
  totalWages: number;
  status: string;
  createdAt: string;
}

type Tab = "purchase" | "maintenance" | "payouts";

export function ApprovalsClient() {
  const [tab, setTab] = useState<Tab>("purchase");
  const purchase = useApi<{ requests: PurchaseRequestRow[]; canApprove: boolean }>("/api/purchase-requests");
  const maintenance = useApi<{ requests: MaintenanceRequestRow[]; canApprove: boolean }>("/api/maintenance-requests");
  const payouts = useApi<{ requests: PayoutApprovalRow[]; canApprove: boolean }>("/api/payout-approvals");

  const pendingCount =
    (purchase.data?.requests.filter((r) => r.status === "PENDING").length ?? 0) +
    (maintenance.data?.requests.filter((r) => r.status === "PENDING").length ?? 0) +
    (payouts.data?.requests.filter((r) => r.status === "PENDING").length ?? 0);

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

      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium ${tab === t.id ? "border-b-2 border-brand text-brand" : "text-gray-500"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "purchase" && <PurchaseRequestsTab data={purchase.data} loading={purchase.loading} error={purchase.error} refetch={purchase.refetch} />}
      {tab === "maintenance" && <MaintenanceTab data={maintenance.data} loading={maintenance.loading} error={maintenance.error} refetch={maintenance.refetch} />}
      {tab === "payouts" && <PayoutsTab data={payouts.data} loading={payouts.loading} error={payouts.error} refetch={payouts.refetch} />}
    </div>
  );
}

async function act(path: string, status: "APPROVED" | "REJECTED", extra?: Record<string, unknown>) {
  return postJson(path, { status, ...extra }, "PATCH");
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
          { header: "Status", render: (r) => <Badge status={r.status} /> },
          { header: "", render: (r) =>
              data.canApprove && r.status === "PENDING" ? (
                <div className="flex gap-1">
                  <Button size="sm" onClick={async () => { await act(`/api/purchase-requests/${r.id}`, "APPROVED"); refetch(); }}>Approve</Button>
                  <Button size="sm" variant="secondary" onClick={async () => { await act(`/api/purchase-requests/${r.id}`, "REJECTED"); refetch(); }}>Reject</Button>
                </div>
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
          { header: "Status", render: (r) => <Badge status={r.status} /> },
          { header: "", render: (r) =>
              data.canApprove && r.status === "PENDING" ? (
                <div className="flex gap-1">
                  <Button size="sm" onClick={async () => { await act(`/api/maintenance-requests/${r.id}`, "APPROVED"); refetch(); }}>Approve</Button>
                  <Button size="sm" variant="secondary" onClick={async () => { await act(`/api/maintenance-requests/${r.id}`, "REJECTED"); refetch(); }}>Reject</Button>
                </div>
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
      setRaiseError(Object.values(result.fieldErrors ?? {}).flat().join(" ") || "Could not raise payout approval");
      return;
    }
    refetch();
  }

  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote message={`Couldn't load payout approvals: ${error}`} onRetry={refetch} />;
  if (!data) return null;

  const alreadyRaised = data.requests.some((r) => r.month === month);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="Flag a month's wages for payout" />
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker month={month} onChange={setMonth} max={thisMonth} />
          <Button size="sm" onClick={raise} disabled={raising || alreadyRaised}>
            {alreadyRaised ? "Already raised" : raising ? "Raising…" : `Request approval for ${monthLabel(month)}`}
          </Button>
        </div>
        {raiseError && <p className="mt-2 text-sm text-red-700">{raiseError}</p>}
        <p className="mt-2 text-xs text-gray-500">
          Approving creates an Expense (category &quot;wages&quot;) and its ledger entry for that month&apos;s accrued wage total — this is the one approval that is itself the real-world event.
        </p>
      </Card>

      <Card>
        <CardHeader title="Payout approvals" />
        <Table
          columns={[
            { header: "Month", render: (r: PayoutApprovalRow) => monthLabel(r.month) },
            { header: "Wages", className: "text-right tabular-nums", render: (r) => inr(r.totalWages) },
            { header: "Status", render: (r) => <Badge status={r.status} /> },
            { header: "", render: (r) =>
                data.canApprove && r.status === "PENDING" ? (
                  <div className="flex gap-1">
                    <Button size="sm" onClick={async () => { await act(`/api/payout-approvals/${r.id}`, "APPROVED"); refetch(); }}>Approve</Button>
                    <Button size="sm" variant="secondary" onClick={async () => { await act(`/api/payout-approvals/${r.id}`, "REJECTED"); refetch(); }}>Reject</Button>
                  </div>
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
