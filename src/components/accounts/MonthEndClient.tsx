"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { useApi } from "@/lib/useApi";
import { currentMonthKey } from "@/lib/accounts/period";
import { EXPENSE_CATEGORY_LABEL, inr, pct } from "@/lib/accounts/format";
import type { MonthSummary } from "@/lib/accounts/summary";
import { MonthPicker } from "./MonthPicker";
import { ErrorNote, Loading, PageTitle, Stat } from "./Stat";

function Line({ label, value, strong, hint }: { label: string; value: string; strong?: boolean; hint?: string }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "border-t border-border font-semibold" : ""}`}>
      <span className="text-sm text-gray-600">
        {label}
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </span>
      <span className="text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function MonthEndClient() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const { data, loading, error, refetch } = useApi<MonthSummary>(`/api/analytics/profit-month?month=${month}`);

  const maxExpense = data ? Math.max(1, ...Object.values(data.cash.expensesByCategory)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Month-end summary"
        subtitle="Profit is booked when an order is first invoiced. Every figure is computed from attendance, expenses, payments, rolls and production rows."
        action={
          <div className="flex items-center gap-2 print:hidden">
            <MonthPicker month={month} onChange={setMonth} max={thisMonth} />
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      {error && <ErrorNote message={`Couldn't load the summary: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Net profit (booked)"
              value={inr(data.pnl.netProfit)}
              tone={data.pnl.netProfit < 0 ? "bad" : data.pnl.ordersRealised ? "good" : "default"}
              hint={data.pnl.ordersRealised ? `Margin ${pct(data.pnl.marginPct)}` : "No order invoiced this month"}
            />
            <Stat label="Payments received" value={inr(data.cash.paymentsReceived)} hint={`${data.cash.paymentsCount} payment(s)`} />
            <Stat
              label="Receivables outstanding"
              value={inr(data.receivables.outstanding)}
              tone={data.receivables.outstanding > 0 ? "bad" : "default"}
              hint={`${data.receivables.invoicesOpen} open invoice(s), all months`}
            />
            <Stat label="Wages earned" value={inr(data.wages.accrued)} hint={`${data.wages.workers} worker(s) marked`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2 *:min-w-0">
            <Card>
              <CardHeader title="Profit & loss (accrual)" action={<Link href="/accounts/costing" className="text-xs font-medium text-brand hover:underline">Per order →</Link>} />
              <Line label={`Revenue — ${data.pnl.ordersRealised} order(s) invoiced`} hint="qty × price per metre, ex-GST" value={inr(data.pnl.revenue)} />
              <Line label="Cost of those orders" hint="yarn, wastage, wages, power, overhead, direct bills" value={`− ${inr(data.pnl.costOfOrders)}`} />
              <Line label="Gross profit" value={inr(data.pnl.grossProfit)} strong />
              <Line
                label="Unabsorbed period cost"
                hint="this month's power/overhead/indirect wages with no production to carry them"
                value={`− ${inr(data.pnl.unabsorbedPeriodCost)}`}
              />
              <Line label="Net profit" value={inr(data.pnl.netProfit)} strong />
              <p className="mt-2 text-xs text-gray-500">
                Work in progress: {data.workInProgress.orders} order(s), {inr(data.workInProgress.costToDate)} cost to date (not in profit until invoiced).
              </p>
            </Card>

            <Card>
              <CardHeader title="Bills recorded this month" action={<Link href="/accounts/expenses" className="text-xs font-medium text-brand hover:underline">Expenses →</Link>} />
              {data.cash.expensesTotal === 0 ? (
                <EmptyState title="No expenses recorded" description="Add power, yarn, overhead and wage bills under Expenses." />
              ) : (
                <div className="flex flex-col gap-2">
                  {Object.entries(data.cash.expensesByCategory).map(([cat, amount]) => (
                    <div key={cat} className="flex flex-col gap-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">{EXPENSE_CATEGORY_LABEL[cat] ?? cat}</span>
                        <span className="tabular-nums">{inr(amount)}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full bg-brand" style={{ width: `${(amount / maxExpense) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                  <Line label="Total" value={inr(data.cash.expensesTotal)} strong />
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Yarn bills are stock purchases and wage bills are payroll payouts; order costs use yarn consumed and wages earned instead, so neither is counted twice.
              </p>
            </Card>

            <Card>
              <CardHeader title="Invoicing & GST" />
              <Line label={`Invoices raised (${data.cash.invoicesCount})`} value={inr(data.cash.invoicedTotal)} />
              <Line label="GST on those invoices" value={inr(data.cash.gstInvoiced)} />
              <Line label="Payments received" value={inr(data.cash.paymentsReceived)} />
            </Card>

            <Card>
              <CardHeader title="Labour & overhead pool" action={<Link href="/accounts/attendance" className="text-xs font-medium text-brand hover:underline">Attendance →</Link>} />
              <Line label="Present / half / absent marks" value={`${data.wages.presentDays} / ${data.wages.halfDays} / ${data.wages.absentDays}`} />
              {data.pool ? (
                <>
                  <Line label="Power bills spread on orders" value={inr(data.pool.power)} />
                  <Line label="Overhead + other bills spread" value={inr(data.pool.overhead)} />
                  <Line label="Indirect labour spread" hint="wages not tied to a producing machine" value={inr(data.pool.indirectLabour)} />
                  <Line label="Machine-shifts logged" hint="the base these are spread over" value={String(data.pool.machineShiftUnits)} />
                </>
              ) : (
                <p className="text-sm text-gray-500">No power, overhead or attendance cost in this month.</p>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
