import { ReactNode } from "react";

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border-strong bg-surface-low/60 px-4 py-12 text-center">
      <svg viewBox="0 0 24 24" className="mb-1 h-8 w-8 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
        <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="square" />
      </svg>
      <p className="font-display text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-gray-500">{description}</p>}
      {action}
    </div>
  );
}
