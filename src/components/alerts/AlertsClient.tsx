"use client";
import { useMemo, useState } from "react";
import { Button, Card, CardHeader, EmptyState, Input, Select } from "@/components/ui";
import { postJson, useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { statusBadgeClass } from "@/lib/tokens";
import {
  alertKind,
  alertKindLabel,
  formatAlertTime,
  severityStatus,
  whatsappPreviewText,
  type NotificationRow,
} from "@/lib/accounts/alert-format";
import { ErrorNote, Loading, PageTitle } from "@/components/accounts/Stat";

export function AlertsClient() {
  const [show, setShow] = useState("unread");
  const [severity, setSeverity] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const url = `/api/alerts?limit=200${show === "unread" ? "&unread=1" : ""}${severity ? `&severity=${severity}` : ""}`;
  const { data, loading, error, refetch } = useApi<{ notifications: NotificationRow[]; unreadCount: number; total: number }>(url);
  useRealtimeEvent(RealtimeEvents.NotificationNew, () => refetch());

  const all = useMemo(() => data?.notifications ?? [], [data]);
  const kinds = useMemo(() => [...new Set(all.map((n) => alertKind(n.type)))].sort(), [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((n) => (!kind || alertKind(n.type) === kind) && (!needle || n.message.toLowerCase().includes(needle)));
  }, [all, kind, q]);
  const preview = rows.find((n) => n.id === previewId) ?? rows[0] ?? null;

  async function setRead(ids: string[], read: boolean) {
    await postJson("/api/alerts", { ids, read }, "PATCH");
    refetch();
  }
  async function markAll() {
    await postJson("/api/alerts", { all: true }, "PATCH");
    refetch();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Notification centre"
        subtitle="Low stock, breakdowns, delay risk, orders ready and payments, from every module."
        action={
          (data?.unreadCount ?? 0) > 0 ? (
            <Button variant="secondary" onClick={markAll}>
              Mark all {data?.unreadCount} read
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <Input aria-label="Search alerts" placeholder="Search alert text" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select aria-label="Show" value={show} onChange={(e) => setShow(e.target.value)} options={[{ value: "unread", label: "Unread" }, { value: "all", label: "All" }]} />
        <Select
          aria-label="Severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          options={[
            { value: "", label: "Any severity" },
            { value: "critical", label: "Critical" },
            { value: "warning", label: "Warning" },
            { value: "info", label: "Info" },
          ]}
        />
        <Select
          aria-label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          options={[{ value: "", label: "Any type" }, ...kinds.map((k) => ({ value: k, label: alertKindLabel(k) }))]}
        />
      </div>

      {error && <ErrorNote message={`Couldn't load alerts: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}

      {data && (
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-2">
            {rows.length === 0 ? (
              <EmptyState title={show === "unread" ? "No unread alerts" : "No alerts"} description="New alerts appear here the moment any module raises them." />
            ) : (
              rows.map((n) => (
                <Card
                  key={n.id}
                  className={`flex cursor-pointer flex-col gap-2 sm:flex-row sm:items-start ${preview?.id === n.id ? "ring-2 ring-brand/40" : ""} ${n.read ? "opacity-70" : ""}`}
                  onClick={() => setPreviewId(n.id)}
                >
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(severityStatus(n.severity))}`}>
                        {alertKindLabel(n.type)}
                      </span>
                      <span className="text-xs capitalize text-gray-500">{n.severity}</span>
                      <span className="text-xs text-gray-400">{formatAlertTime(n.createdAt)}</span>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-brand" aria-label="Unread" />}
                    </div>
                    <p className="mt-1 text-sm text-foreground">{n.message}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRead([n.id], !n.read);
                    }}
                  >
                    {n.read ? "Mark unread" : "Mark read"}
                  </Button>
                </Card>
              ))
            )}
          </div>

          <Card className="h-fit lg:sticky lg:top-4">
            <CardHeader title="WhatsApp preview" />
            <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Preview only. Nothing is sent; real WhatsApp delivery is future work.
            </p>
            {preview ? (
              <div className="rounded-xl bg-gray-100 p-3">
                <p className="mb-2 text-center text-[11px] text-gray-500">Owner · Everest Textile Mills</p>
                <div className="ml-auto max-w-[95%] whitespace-pre-wrap rounded-lg rounded-tr-none bg-green-100 p-2 text-sm text-gray-800 shadow-sm">
                  <WhatsAppText text={whatsappPreviewText(preview)} />
                  <p className="mt-1 text-right text-[10px] text-gray-500">✓✓ preview</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Select an alert to preview the message.</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

/** Renders WhatsApp's *bold* and _italic_ markers. */
function WhatsAppText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("*") && p.endsWith("*") ? (
          <strong key={i}>{p.slice(1, -1)}</strong>
        ) : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? (
          <em key={i} className="text-gray-500">{p.slice(1, -1)}</em>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
