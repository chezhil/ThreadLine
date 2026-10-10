import { HTMLAttributes, ReactNode } from "react";

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-md border border-border/80 bg-white p-4 shadow-sm ${className}`}
      {...props}
    />
  );
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-[15px] font-semibold text-foreground">
        <span className="h-3 w-3 shrink-0 bg-brand" aria-hidden="true" />
        {title}
      </h3>
      {action}
    </div>
  );
}
