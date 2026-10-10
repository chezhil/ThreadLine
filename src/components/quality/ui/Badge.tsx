import React from "react";
import { cn } from "@/lib/utils";
import { getStatusBadgeStyle } from "./tokens";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status?: string;
  variant?: "neutral" | "primary" | "success" | "warning" | "danger";
}

export function Badge({ status, variant, className, children, ...props }: BadgeProps) {
  if (status) {
    const style = getStatusBadgeStyle(status);
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-[11px] font-semibold tracking-wide border",
          style.bg,
          style.text,
          style.border,
          className
        )}
        {...props}
      >
        <span className={cn("w-1.5 h-1.5 rounded-full", style.dot)} />
        {children || status.toUpperCase()}
      </span>
    );
  }

  const variants = {
    neutral: "bg-slate-100 text-slate-700 border-slate-200",
    primary: "bg-indigo-50 text-indigo-700 border-indigo-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-rose-50 text-rose-700 border-rose-200",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-sm text-[11px] font-semibold tracking-wide border",
        variants[variant || "neutral"],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
