import { Card } from "@/components/ui";

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad";
}) {
  const color = tone === "good" ? "text-emerald-700" : tone === "bad" ? "text-red-700" : "text-foreground";
  const rail = tone === "good" ? "bg-emerald-600" : tone === "bad" ? "bg-red-600" : "bg-brand";
  return (
    <Card className="relative flex flex-col gap-1.5 overflow-hidden">
      <span className={`absolute inset-y-0 left-0 w-0.5 ${rail}`} aria-hidden="true" />
      <span className="label-caps text-gray-500">{label}</span>
      <span className={`display-num text-2xl leading-8 ${color}`}>{value}</span>
      {hint && <span className="text-xs text-gray-500">{hint}</span>}
    </Card>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-7 tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-0.5 text-[13px] text-gray-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md border border-red-200 border-l-4 border-l-red-600 bg-red-50 px-3 py-2 text-[13px] text-red-800"
    >
      <span>{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="shrink-0 text-xs font-semibold underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-gray-500" role="status">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-brand" aria-hidden="true" />
      {label}
    </div>
  );
}
