// ThreadLine Design Tokens
// Defined once and reused across all modules. Never hardcode hex values or magic spacing.

export const tokens = {
  colors: {
    status: {
      pass: {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
        raw: "#16a34a",
      },
      running: {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        dot: "bg-emerald-500",
        raw: "#16a34a",
      },
      rework: {
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
        dot: "bg-amber-500",
        raw: "#d97706",
      },
      idle: {
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
        dot: "bg-amber-500",
        raw: "#d97706",
      },
      reject: {
        bg: "bg-rose-50",
        text: "text-rose-700",
        border: "border-rose-200",
        dot: "bg-rose-500",
        raw: "#dc2626",
      },
      breakdown: {
        bg: "bg-rose-50",
        text: "text-rose-700",
        border: "border-rose-200",
        dot: "bg-rose-500",
        raw: "#dc2626",
      },
      pending: {
        bg: "bg-slate-100",
        text: "text-slate-600",
        border: "border-slate-200",
        dot: "bg-slate-400",
        raw: "#6b7280",
      },
    },
    primary: {
      bg: "bg-indigo-600",
      hover: "hover:bg-indigo-700",
      text: "text-white",
      light: "bg-indigo-50 text-indigo-700",
      raw: "#4f46e5",
    },
    neutral: {
      card: "bg-white",
      page: "bg-slate-50",
      border: "border-slate-200",
      textMain: "text-slate-900",
      textMuted: "text-slate-500",
      divider: "border-slate-100",
    },
  },
  spacing: {
    xs: "p-1 m-1 gap-1",
    sm: "p-2 m-2 gap-2",
    md: "p-4 m-4 gap-4",
    lg: "p-6 m-6 gap-6",
    xl: "p-8 m-8 gap-8",
  },
  radius: {
    sm: "rounded-md",
    md: "rounded-lg",
    lg: "rounded-xl",
    full: "rounded-full",
  },
  typography: {
    title: "text-2xl font-bold tracking-tight text-slate-900",
    subtitle: "text-sm text-slate-500 font-medium",
    section: "text-lg font-semibold text-slate-800",
    body: "text-sm text-slate-700",
    caption: "text-xs text-slate-400",
  },
} as const;

export type StatusType = keyof typeof tokens.colors.status;

export function getStatusBadgeStyle(status: string) {
  const normalized = status.toLowerCase() as StatusType;
  return tokens.colors.status[normalized] || tokens.colors.status.pending;
}
