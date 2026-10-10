// Month and day boundaries for Accounts, computed in mill time (IST, UTC+05:30)
// so a 23:30 production log or attendance mark lands on the right day/month.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** "YYYY-MM-DD" of the given instant, in IST. */
export function istDateKey(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM" of the given instant, in IST. */
export function istMonthKey(date: Date): string {
  return istDateKey(date).slice(0, 7);
}

export function currentMonthKey(now = new Date()): string {
  return istMonthKey(now);
}

/** Start (inclusive) and end (exclusive) instants of an IST calendar month. */
export function monthRange(month: string): { start: Date; end: Date } {
  if (!MONTH_PATTERN.test(month)) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - IST_OFFSET_MS);
  const end = new Date(Date.UTC(y, m, 1) - IST_OFFSET_MS);
  return { start, end };
}

/** Start (inclusive) and end (exclusive) instants of an IST calendar day "YYYY-MM-DD". */
export function dayRange(dateKey: string): { start: Date; end: Date } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Normalise a date-only value to IST midnight so one day = one stored instant. */
export function istMidnight(date: Date): Date {
  return dayRange(istDateKey(date)).start;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
