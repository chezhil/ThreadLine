// Deterministic, data-only answers for each assistant tool. Used when the local
// model is unavailable, and as the replacement whenever the model's wording
// contains a number that isn't in the query result. Every figure printed here
// comes straight from the tool's returned data.

/* eslint-disable @typescript-eslint/no-explicit-any */

const inr = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const pct = (n: number | null | undefined) => (n == null ? "n/a" : `${n}%`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function summarize(tool: string, d: any): string {
  switch (tool) {
    case "profitByOrder": {
      const realised: any[] = d.realisedOrders ?? [];
      const wip: any[] = d.inProgressOrders ?? [];
      if (!realised.length) {
        return `No order was invoiced in ${d.monthLabel}, so no order profit is booked for that month yet.${
          wip.length ? ` ${plural(wip.length, "order")} in progress had activity then (cost to date only, not final profit).` : ""
        }`;
      }
      const low = realised[0];
      const high = realised[realised.length - 1];
      const gaps = low.dataGaps?.length ? ` Note for ${low.orderNo}: ${low.dataGaps.join(" ")}` : "";
      const lowLine = `${low.orderNo} (${low.buyer}) made the least profit in ${d.monthLabel}: ${inr(low.profit)} on revenue of ${inr(low.revenue)} against a true cost of ${inr(low.totalCost)} (margin ${pct(low.marginPct)}).`;
      if (realised.length === 1) return `${lowLine} It is the only order invoiced that month.${gaps}`;
      return `${lowLine} The most profitable was ${high.orderNo} (${high.buyer}) at ${inr(high.profit)} (margin ${pct(high.marginPct)}). ${plural(realised.length, "order")} were invoiced that month.${gaps}`;
    }
    case "orderCost": {
      if (!d.found) return `I couldn't find order ${d.orderNo} in the records.`;
      const c = d.costs;
      const head = `${d.orderNo} (${d.buyerName}, ${d.status}): revenue ${inr(d.revenue)}, true cost ${inr(d.totalCost)}, profit ${inr(d.profit)} (margin ${pct(d.marginPct)})${d.stage === "in_progress" ? " — cost to date, the order is still in progress" : ""}.`;
      const lines = `Cost lines: yarn ${inr(c.yarn)}, process wastage ${inr(c.processWastage)}, direct wages ${inr(c.directWages)}, power ${inr(c.power)}, overhead ${inr(c.overhead)}, indirect labour ${inr(c.indirectLabour)}, direct expenses ${inr(c.directExpenses)}.`;
      const paid = d.invoicedTotal > 0 ? ` Invoiced ${inr(d.invoicedTotal)}, paid ${inr(d.paid)}, outstanding ${inr(d.outstanding)}.` : " Not invoiced yet.";
      const gaps = d.dataGaps?.length ? ` Data gaps: ${d.dataGaps.join(" ")}` : "";
      return `${head} ${lines}${paid}${gaps}`;
    }
    case "monthSummary": {
      const p = d.pnl;
      const booked = p.ordersRealised
        ? `${plural(p.ordersRealised, "order")} invoiced: revenue ${inr(p.revenue)}, cost of those orders ${inr(p.costOfOrders)}, unabsorbed overhead ${inr(p.unabsorbedPeriodCost)}, net profit ${inr(p.netProfit)} (margin ${pct(p.marginPct)}).`
        : `No order was invoiced in ${d.label}, so no profit is booked yet${p.unabsorbedPeriodCost ? ` (unabsorbed overhead ${inr(p.unabsorbedPeriodCost)})` : ""}.`;
      return `${d.label}: ${booked} Payments received ${inr(d.cash.paymentsReceived)}, expenses recorded ${inr(d.cash.expensesTotal)}, wages earned per attendance ${inr(d.wages.accrued)}. Receivables outstanding: ${inr(d.receivables.outstanding)} across ${plural(d.receivables.invoicesOpen, "invoice")}.`;
    }
    case "machineOutput": {
      const ms: any[] = (d.machines ?? []).filter((m: any) => m.periodOutput > 0).sort((a: any, b: any) => b.periodOutput - a.periodOutput);
      if (!ms.length) return `No production was logged on any machine from ${d.from} to ${d.to}.`;
      const top = ms.slice(0, 3).map((m) => `${m.name} ${m.periodOutput} m`).join(", ");
      return `From ${d.from} to ${d.to} the mill logged ${d.totals.periodOutput} m (${d.totals.todayOutput} m today). Top machines: ${top}.`;
    }
    case "machineRejectRate": {
      const ms: any[] = d.machines ?? [];
      if (!ms.length) return d.filter ? `No inspected rolls from a machine matching "${d.filter}" in the last ${d.days} days.` : `No rolls were inspected in the last ${d.days} days.`;
      const worst = ms[0];
      const rest = ms.slice(1, 3).map((m) => `${m.name} ${pct(m.rejectRatePct)}`).join(", ");
      return `Over the last ${d.days} days, ${worst.name} rejected ${worst.reject} of ${worst.inspected} inspected rolls (reject rate ${pct(worst.rejectRatePct)}${worst.shareOfRejectsPct != null ? `, ${pct(worst.shareOfRejectsPct)} of all rejects` : ""}).${rest ? ` Next: ${rest}.` : ""}`;
    }
    case "defectsByType": {
      const entries = Object.entries(d.defects ?? {}).sort((a: any, b: any) => b[1] - a[1]);
      if (!entries.length) return `No defects were recorded in ${plural(d.inspections, "inspection")} over the last ${d.days} days.`;
      return `Defects in the last ${d.days} days (${plural(d.inspections, "inspection")}): ${entries.map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ")}.`;
    }
    case "yarnStock": {
      const ys: any[] = d.yarnTypes ?? [];
      if (!ys.length) return "No yarn types match — nothing is below its low-stock threshold.";
      const low = ys.filter((y) => y.low);
      const list = (low.length ? low : ys).map((y) => `${y.yarn} ${y.remainingKg} kg (threshold ${y.thresholdKg} kg)`).join("; ");
      return low.length ? `${plural(low.length, "yarn type")} at or below threshold: ${list}.` : `No yarn is below its threshold. Stock: ${list}.`;
    }
    case "outstandingPayments": {
      const open: any[] = d.openInvoices ?? [];
      if (!d.invoicesTotal) return "There are no invoices in the records yet.";
      if (!open.length) return d.invoicesTotal === 1 ? "The only invoice is fully paid." : `All ${d.invoicesTotal} invoices are fully paid.`;
      const biggest = [...open].sort((a, b) => b.outstanding - a.outstanding).slice(0, 3);
      return `${inr(d.totalOutstanding)} is outstanding across ${plural(open.length, "invoice")}. Largest: ${biggest.map((i) => `${i.invoiceNo} ${i.buyer} ${inr(i.outstanding)}`).join("; ")}.`;
    }
    case "attendanceSummary": {
      const ws: any[] = d.workers ?? [];
      const marked = ws.filter((w) => w.present + w.halfDay + w.absent > 0);
      if (!marked.length) return `No attendance is marked for ${d.monthLabel}.`;
      const absent = (d.mostAbsent ?? []).map((w: any) => `${w.worker} (${w.absent})`).join(", ");
      return `${d.monthLabel}: wages earned per attendance total ${inr(d.totalWages)} for ${plural(marked.length, "worker")}.${absent ? ` Most absences: ${absent}.` : " No absences recorded."}`;
    }
    case "ordersOverview": {
      const os: any[] = d.orders ?? [];
      if (!os.length) return "No orders match.";
      return `${plural(d.count, "order")}: ${os.slice(0, 6).map((o) => `${o.orderNo} ${o.buyer} ${o.status} due ${o.deadline}`).join("; ")}${os.length > 6 ? "; …" : ""}.`;
    }
    case "recentAlerts": {
      const as: any[] = d.alerts ?? [];
      if (!as.length) return "There are no unread alerts.";
      return `${plural(as.length, "unread alert")}: ${as.slice(0, 4).map((a) => a.message).join(" ")}`;
    }
    default:
      return "No summary is available for that query.";
  }
}
