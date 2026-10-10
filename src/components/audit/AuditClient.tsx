"use client";
import { Fragment, useState } from "react";
import { Button, EmptyState, Input, Select } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { ErrorNote, Loading, PageTitle } from "@/components/accounts/Stat";
import { dateTimeIN } from "@/lib/accounts/format";

interface Entry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  oldValue: string | null;
  newValue: string | null;
  userId: string;
  userName: string | null;
  userRole: string | null;
  at: string;
}

interface AuditResponse {
  entries: Entry[];
  total: number;
  page: number;
  pageSize: number;
  filters: { entities: string[]; actions: string[]; users: { id: string; name: string }[] };
}

const PAGE_SIZE = 50;

function parse(v: string | null): unknown {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

const show = (v: unknown) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

/** Field-by-field old → new for object snapshots; whole values otherwise. */
function Diff({ oldValue, newValue }: { oldValue: string | null; newValue: string | null }) {
  const a = parse(oldValue);
  const b = parse(newValue);
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(ao), ...Object.keys(bo)])].filter((k) => JSON.stringify(ao[k]) !== JSON.stringify(bo[k]));
    if (!keys.length) return <p className="text-xs text-gray-500">No field changed.</p>;
    return (
      <table className="text-xs">
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <td className="pr-3 font-medium text-gray-600">{k}</td>
              <td className="pr-2 text-red-700 line-through">{show(ao[k])}</td>
              <td className="text-green-700">{show(bo[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <div className="grid gap-2 text-xs sm:grid-cols-2">
      <div>
        <p className="font-medium text-gray-600">Before</p>
        <pre className="whitespace-pre-wrap break-all rounded bg-red-50 p-2 text-red-800">{a == null ? "—" : JSON.stringify(a, null, 2)}</pre>
      </div>
      <div>
        <p className="font-medium text-gray-600">After</p>
        <pre className="whitespace-pre-wrap break-all rounded bg-green-50 p-2 text-green-800">{b == null ? "—" : JSON.stringify(b, null, 2)}</pre>
      </div>
    </div>
  );
}

export function AuditClient() {
  const [entity, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (entity) params.set("entity", entity);
  if (action) params.set("action", action);
  if (userId) params.set("userId", userId);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (q.trim()) params.set("q", q.trim());
  const { data, loading, error, refetch } = useApi<AuditResponse>(`/api/audit?${params}`);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const resetPage = <T,>(fn: (v: T) => void) => (v: T) => {
    setPage(1);
    fn(v);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Audit trail" subtitle="Who changed what, and when: stock intake, QC results, order and machine status, payments, attendance and more." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
        <div className="lg:col-span-2">
          <Input aria-label="Search" placeholder="Search id or value (e.g. EVR-2610)" value={q} onChange={(e) => resetPage(setQ)(e.target.value)} className="w-full" />
        </div>
        <Select aria-label="Entity" value={entity} onChange={(e) => resetPage(setEntity)(e.target.value)} options={[{ value: "", label: "All records" }, ...(data?.filters.entities ?? []).map((x) => ({ value: x, label: x }))]} />
        <Select aria-label="Action" value={action} onChange={(e) => resetPage(setAction)(e.target.value)} options={[{ value: "", label: "All actions" }, ...(data?.filters.actions ?? []).map((x) => ({ value: x, label: x.replace(/_/g, " ") }))]} />
        <Select aria-label="User" value={userId} onChange={(e) => resetPage(setUserId)(e.target.value)} options={[{ value: "", label: "Anyone" }, ...(data?.filters.users ?? []).map((u) => ({ value: u.id, label: u.name }))]} />
        <div className="grid grid-cols-2 gap-2 lg:col-span-2">
          <Input aria-label="From date" type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)} />
          <Input aria-label="To date" type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)} />
        </div>
      </div>

      {error && <ErrorNote message={`Couldn't load the audit trail: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}

      {data &&
        (data.entries.length === 0 ? (
          <EmptyState title="No audit entries match" description="Every create, status change and correction across modules is logged here." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {["When", "Who", "Record", "Action", "Change"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-gray-600">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-white">
                {data.entries.map((e) => (
                  <Fragment key={e.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{dateTimeIN(e.at)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {e.userName ?? <span className="text-gray-400" title={e.userId}>unknown user</span>}
                        {e.userRole && <span className="block text-xs text-gray-400">{e.userRole.replace(/_/g, " ")}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {e.entity}
                        <span className="block font-mono text-xs text-gray-400" title={e.entityId}>{e.entityId.slice(0, 8)}…</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 capitalize">{e.action.replace(/_/g, " ")}</td>
                      <td className="px-3 py-2">
                        <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setExpanded(expanded === e.id ? null : e.id)}>
                          {expanded === e.id ? "Hide" : "Show"} change
                        </button>
                      </td>
                    </tr>
                    {expanded === e.id && (
                      <tr>
                        <td colSpan={5} className="bg-gray-50 px-3 py-2">
                          <Diff oldValue={e.oldValue} newValue={e.newValue} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {data && data.total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            {data.total} entr{data.total === 1 ? "y" : "ies"} · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
