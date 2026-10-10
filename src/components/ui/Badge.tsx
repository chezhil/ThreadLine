import { HTMLAttributes } from "react";
import { statusBadgeClass } from "@/lib/tokens";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Picks the colour; also the label when no children are given. */
  status: string;
}

export function Badge({ status, className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-semibold capitalize leading-4 tracking-wide ${statusBadgeClass(
        status,
      )} ${className}`}
      {...props}
    >
      {children ?? status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
