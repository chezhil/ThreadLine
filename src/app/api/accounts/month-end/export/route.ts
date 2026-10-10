import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { fieldErrorResponse, forbidden, zodFieldErrors } from "@/lib/accounts/http";
import { currentMonthKey } from "@/lib/accounts/period";
import { monthSummary } from "@/lib/accounts/summary";
import { computeCosting } from "@/lib/accounts/costing";
import { monthQuerySchema } from "@/lib/validation/accounts";

// Readiness checklist item 8 (HARDENING_ADDENDUM.md): "CSV export of the
// month-end report ... reuses costing.ts's existing month-end query." No PDF
// library — the browser's own print-to-PDF on costing/payments pages already
// covers that, per the same checklist note.
//
// GET ?month=YYYY-MM (defaults to current month, IST)
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = monthQuerySchema.safeParse(req.nextUrl.searchParams.get("month") ?? undefined);
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const month = parsed.data ?? currentMonthKey();

  const costing = await computeCosting();
  const summary = await monthSummary(month, undefined, costing);
  const orders = costing.orders.filter((o) => o.activeMonths.includes(month));

  const csvEscape = (v: string | number | null): string => {
    let s = v === null ? "" : String(v);
    // Text a spreadsheet would run as a formula (a buyer named "=HYPERLINK(…)")
    // is neutralised with a leading quote; numbers are left as numbers.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const row = (cells: (string | number | null)[]) => cells.map(csvEscape).join(",") + "\r\n";

  // BOM so Excel reads the file as UTF-8 (buyer names, the em dash below).
  let csv = "\uFEFF";
  csv += row([`ThreadLine month-end report — ${summary.label}`]);
  csv += "\r\n";

  csv += row([
    "Order No", "Buyer", "Status", "Stage", "Qty (m)", "Revenue",
    "Yarn", "Process wastage", "Direct wages", "Power", "Overhead",
    "Indirect labour", "Direct expenses", "Total cost", "Profit", "Margin %", "Cost/metre",
  ]);
  for (const o of orders) {
    csv += row([
      o.orderNo, o.buyerName, o.status, o.stage, o.qtyMetres, o.revenue,
      o.costs.yarn, o.costs.processWastage, o.costs.directWages, o.costs.power, o.costs.overhead,
      o.costs.indirectLabour, o.costs.directExpenses, o.totalCost, o.profit, o.marginPct, o.costPerMetre,
    ]);
  }

  csv += "\r\n";
  csv += row(["Summary", summary.label]);
  csv += row(["Orders realised this month", summary.pnl.ordersRealised]);
  csv += row(["Revenue", summary.pnl.revenue]);
  csv += row(["Cost of orders", summary.pnl.costOfOrders]);
  csv += row(["Gross profit", summary.pnl.grossProfit]);
  csv += row(["Unabsorbed period cost", summary.pnl.unabsorbedPeriodCost]);
  csv += row(["Net profit", summary.pnl.netProfit]);
  csv += row(["Margin %", summary.pnl.marginPct]);
  csv += row(["Wages accrued", summary.wages.accrued]);
  csv += row(["Payments received", summary.cash.paymentsReceived]);
  csv += row(["Expenses total", summary.cash.expensesTotal]);
  csv += row(["Outstanding receivables", summary.receivables.outstanding]);
  csv += row(["Work-in-progress orders", summary.workInProgress.orders]);
  csv += row(["Work-in-progress cost to date", summary.workInProgress.costToDate]);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="threadline-month-end-${month}.csv"`,
    },
  });
}
