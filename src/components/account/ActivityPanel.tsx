"use client";
import { useApi } from "@/lib/useApi";
import { dateTimeIN } from "@/lib/accounts/format";
import { EmptyState, Pager } from "@/components/ui";
import { usePaged } from "@/lib/usePaged";
import { Section } from "./controls";

interface Entry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  at: string;
}

// Audit actions are SCREAMING_SNAKE_CASE codes; show them as a sentence.
const ACTION_LABEL: Record<string, string> = {
  PROFILE_UPDATED: "Updated your profile",
  PASSWORD_CHANGED: "Changed your password",
  SESSIONS_REVOKED: "Signed out other devices",
  DISPATCH_CREATED: "Dispatched a truck",
  WHATSAPP_DISPATCH_PREVIEW_SENT: "Sent a WhatsApp dispatch message",
};

export function humanizeAction(action: string): string {
  const known = ACTION_LABEL[action];
  if (known) return known;
  const words = action.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ActivityPanel() {
  const { data, error, refetch } = useApi<{ activity: Entry[] }>("/api/me/activity");
  const rows = data?.activity ?? [];
  const paged = usePaged(rows, 10);
  return (
    <Section title="Your recent activity" description="The last 30 changes made under your account, from the mill's audit trail.">
      {error && (
        <p className="px-5 py-4 text-[13px] text-red-700">
          Couldn&apos;t load your activity.{" "}
          <button type="button" onClick={refetch} className="font-semibold underline">
            Retry
          </button>
        </p>
      )}
      {!data && !error && <p className="px-5 py-4 text-[13px] text-gray-500">Loading…</p>}
      {data && rows.length === 0 && <EmptyState title="Nothing yet" description="Changes you make — orders, dispatches, payments, profile edits — will appear here." />}
      {paged.pageRows.map((r) => (
        <div key={r.id} className="flex items-baseline justify-between gap-4 px-5 py-3 text-[13px]">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{humanizeAction(r.action)}</p>
            <p className="truncate text-xs text-gray-500">
              {r.entity} · <span className="font-mono">{r.entityId.slice(0, 8)}</span>
            </p>
          </div>
          <time dateTime={r.at} className="shrink-0 text-xs text-gray-500">
            {dateTimeIN(r.at)}
          </time>
        </div>
      ))}
      {paged.showPager && (
        <div className="px-5 py-3">
          <Pager {...paged.pagerProps} />
        </div>
      )}
    </Section>
  );
}
