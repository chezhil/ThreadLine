import { HTMLAttributes } from "react";
import { statusBadgeClass } from "@/lib/tokens";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status: string;
}

export function Badge({ status, className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(
        status,
      )} ${className}`}
      {...props}
    >
      {status.replace(/_/g, " ").toLowerCase()}
    </span>
  );
}
