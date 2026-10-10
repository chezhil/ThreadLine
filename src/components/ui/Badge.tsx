import { HTMLAttributes } from "react";
import { statusBadgeClass } from "@/lib/tokens";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Picks the colour; also the label when no children are given. */
  status: string;
}

export function Badge({ status, className = "", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(
        status,
      )} ${className}`}
      {...props}
    >
      {children ?? status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
