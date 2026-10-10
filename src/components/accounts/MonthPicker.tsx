"use client";
import { Button } from "@/components/ui";
import { monthLabel, shiftMonth } from "@/lib/accounts/period";

export function MonthPicker({
  month,
  onChange,
  max,
}: {
  month: string;
  onChange: (month: string) => void;
  /** Latest selectable month (YYYY-MM), usually the current month. */
  max: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Month">
      <Button variant="secondary" size="sm" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </Button>
      <span className="min-w-32 text-center text-sm font-medium text-foreground">{monthLabel(month)}</span>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Next month"
        disabled={month >= max}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        ›
      </Button>
    </div>
  );
}
