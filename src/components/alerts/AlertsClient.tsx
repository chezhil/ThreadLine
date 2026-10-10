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

interface AlertDeliveryRow {
  id: string;
  channel: string;
  recipient: string;
  templateName: string | null;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
  receipt: string | null;
}

export function AlertsClient({ showOutbox = false }: { showOutbox?: boolean }) {
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
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem] *:min-w-0">
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

          {showOutbox && <OutboxCard />}
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

/** Owner-only view of buyer alerts queued for delivery (the API 403s for
 * every other role, so the page only renders this for the owner). */
function OutboxCard() {
  const { data: outbox, error, refetch } = useApi<{ deliveries: AlertDeliveryRow[]; pendingCount: number }>(
    "/api/alerts/outbox?limit=20",
  );
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  async function processOutbox() {
    setProcessing(true);
    const result = await postJson("/api/alerts/outbox/process", {});
    setProcessing(false);
    setProcessError(result.ok ? null : (result.error ?? "Couldn't process the outbox"));
    refetch();
  }
  if (error) return <ErrorNote message={`Couldn't load the delivery outbox: ${error}`} onRetry={refetch} />;
  if (!outbox) return null;
  return (
    <Card className="h-fit">
      <CardHeader
        title="Delivery outbox"
        action={
          <Button size="sm" variant="secondary" onClick={processOutbox} disabled={processing}>
            {processing ? "Processing…" : "Process now"}
          </Button>
        }
      />
      {processError && <p role="alert" className="mb-2 text-xs text-red-700">{processError}</p>}
      <p className="mb-3 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-800">
        {outbox.pendingCount > 0
          ? `${outbox.pendingCount} queued for delivery.`
          : "Nothing queued."}{" "}
        WhatsApp alerts go out through the WhatsApp Cloud API when it is configured and show delivered/read receipts
        below; otherwise (and for SMS/email) the send is simulated.
      </p>
      {outbox.deliveries.length === 0 ? (
        <p className="text-sm text-gray-500">No buyer alerts queued yet — these appear when an order becomes ready or is dispatched.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {outbox.deliveries.map((d) => (
            <div key={d.id} className="rounded-md border border-border px-2 py-1.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 font-medium ${statusBadgeClass(d.status)}`}>{d.status}</span>
                {d.receipt && (
                  <span className={`rounded-full border px-2 py-0.5 font-medium ${statusBadgeClass(d.receipt === "FAILED" ? "FAILED" : "SENT")}`}>
                    {d.receipt === "READ" ? "Read" : d.receipt === "DELIVERED" ? "Delivered" : "Failed"}
                  </span>
                )}
                <span className="font-medium text-foreground">{d.templateName ?? d.channel}</span>
                <span className="text-gray-400">→ {d.recipient}</span>
                <span className="ml-auto text-gray-400">{formatAlertTime(d.createdAt)}</span>
              </div>
              {d.lastError && (
                <p className="mt-1 text-red-700">
                  {d.attempts}/{d.maxAttempts} attempts — {d.lastError}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
