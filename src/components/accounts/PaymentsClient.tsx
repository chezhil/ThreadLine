"use client";
import { useMemo, useState } from "react";
import { Button, Card, CardHeader, Drawer, EmptyState, Input, Select, Table } from "@/components/ui";
import { postJson, useApi } from "@/lib/useApi";
import { statusBadgeClass } from "@/lib/tokens";
import { currentMonthKey } from "@/lib/accounts/period";
import { dateIN, inr, todayIST } from "@/lib/accounts/format";
import { PAYMENT_MODES, paymentSchema } from "@/lib/validation/accounts";
import { MonthPicker } from "./MonthPicker";
import { ErrorNote, Loading, PageTitle, Stat } from "./Stat";
import { useZodForm } from "./useZodForm";

interface InvoiceRow {
  id: string;
  invoiceNo: string;
  orderNo: string;
  buyerName: string;
  subtotal: number;
  gst: number;
  total: number;
  status: string;
  createdAt: string;
  paid: number;
  outstanding: number;
}

interface PaymentRow {
  id: string;
  invoiceNo: string;
  orderNo: string;
  buyerName: string;
  amount: number;
  mode: string;
  receivedAt: string;
}

const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", neft: "NEFT", rtgs: "RTGS", cheque: "Cheque" };

export function PaymentsClient() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [q, setQ] = useState("");
  const [show, setShow] = useState("open");
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { data, loading, error, refetch } = useApi<{
    payments: PaymentRow[];
    invoices: InvoiceRow[];
    totals: { receivedThisMonth: number; outstanding: number };
  }>(`/api/payments?month=${month}`);

  const invoices = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.invoices ?? []).filter(
      (i) =>
        (show === "all" || (show === "open" ? i.outstanding > 0.005 : i.outstanding <= 0.005)) &&
        (!needle || [i.invoiceNo, i.orderNo, i.buyerName].some((s) => s.toLowerCase().includes(needle))),
    );
  }, [data, q, show]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Buyer payments" subtitle="Record money received against GST invoices. A payment can never exceed what is outstanding." />

      {flash && (
        <div role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          {flash}
        </div>
      )}
      {error && <ErrorNote message={`Couldn't load payments: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Stat label="Outstanding (all invoices)" value={inr(data.totals.outstanding)} tone={data.totals.outstanding > 0 ? "bad" : "default"} />
            <Stat label={`Received in ${month}`} value={inr(data.totals.receivedThisMonth)} hint={`${data.payments.length} payment(s)`} />
            <Stat label="Invoices" value={String(data.invoices.length)} hint={`${data.invoices.filter((i) => i.outstanding > 0.005).length} open`} />
          </div>

          <Card>
            <CardHeader title="Invoices" />
            <div className="mb-3 grid gap-3 sm:grid-cols-[1fr_auto]">
              <Input aria-label="Search invoices" placeholder="Search invoice, order or buyer" value={q} onChange={(e) => setQ(e.target.value)} />
              <Select
                aria-label="Show"
                value={show}
                onChange={(e) => setShow(e.target.value)}
                options={[
                  { value: "open", label: "Outstanding" },
                  { value: "paid", label: "Fully paid" },
                  { value: "all", label: "All invoices" },
                ]}
              />
            </div>
            <Table
              columns={[
                { header: "Invoice", render: (i: InvoiceRow) => <span className="font-medium">{i.invoiceNo}</span> },
                { header: "Date", render: (i) => dateIN(i.createdAt) },
                { header: "Order", render: (i) => i.orderNo },
                { header: "Buyer", render: (i) => i.buyerName },
                { header: "Total (incl. GST)", className: "text-right tabular-nums", render: (i) => inr(i.total, { decimals: true }) },
                { header: "Paid", className: "text-right tabular-nums", render: (i) => inr(i.paid, { decimals: true }) },
                {
                  header: "Outstanding",
                  className: "text-right tabular-nums",
                  render: (i) =>
                    i.outstanding > 0.005 ? <span className="font-semibold text-red-700">{inr(i.outstanding, { decimals: true })}</span> : <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass("pass")}`}>Paid</span>,
                },
                {
                  header: "",
                  render: (i) =>
                    i.outstanding > 0.005 ? (
                      <Button size="sm" variant="secondary" onClick={() => setPayFor(i)}>
                        Record payment
                      </Button>
                    ) : null,
                },
              ]}
              rows={invoices}
              keyFor={(i) => i.id}
              emptyState={
                <EmptyState
                  title={data.invoices.length ? "No invoices match" : "No invoices yet"}
                  description={data.invoices.length ? "Try another filter." : "Invoices are raised from Orders/Dispatch; payments are recorded against them here."}
                />
              }
            />
          </Card>

          <Card>
            <CardHeader title="Payments received" action={<MonthPicker month={month} onChange={setMonth} max={thisMonth} />} />
            <Table
              columns={[
                { header: "Date", render: (p: PaymentRow) => dateIN(p.receivedAt) },
                { header: "Buyer", render: (p) => p.buyerName },
                { header: "Invoice", render: (p) => p.invoiceNo },
                { header: "Order", render: (p) => p.orderNo },
                { header: "Mode", render: (p) => MODE_LABEL[p.mode] ?? p.mode },
                { header: "Amount", className: "text-right tabular-nums", render: (p) => inr(p.amount, { decimals: true }) },
              ]}
              rows={data.payments}
              keyFor={(p) => p.id}
              emptyState={<EmptyState title="No payments received this month" />}
            />
          </Card>
        </>
      )}

      <Drawer open={!!payFor} onClose={() => setPayFor(null)} title={payFor ? `Payment against ${payFor.invoiceNo}` : "Record payment"}>
        {payFor && (
          <PaymentForm
            invoice={payFor}
            onSaved={(msg) => {
              setPayFor(null);
              setFlash(msg);
              refetch();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function PaymentForm({ invoice, onSaved }: { invoice: InvoiceRow; onSaved: (message: string) => void }) {
  const form = useZodForm(paymentSchema, {
    invoiceId: invoice.id,
    amount: String(invoice.outstanding),
    mode: "neft",
    receivedAt: todayIST(),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local = form.validate();
    if (!local) return;
    // Client mirror of the server's balance rule, for an instant message.
    if (local.amount > invoice.outstanding + 0.005) {
      form.setErrors({ amount: [`Only ${inr(invoice.outstanding, { decimals: true })} is outstanding`] });
      return;
    }
    form.setSubmitting(true);
    const res = await postJson<{ outstanding: number }>("/api/payments", form.values);
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the payment"] });
      return;
    }
    onSaved(
      `Recorded ${inr(local.amount, { decimals: true })} from ${invoice.buyerName}. ${
        res.data.outstanding > 0 ? `${inr(res.data.outstanding, { decimals: true })} still outstanding.` : "Invoice fully paid."
      }`,
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
        {invoice.buyerName} · {invoice.orderNo}
        <br />
        Total {inr(invoice.total, { decimals: true })} · paid {inr(invoice.paid, { decimals: true })} ·{" "}
        <span className="font-semibold text-foreground">outstanding {inr(invoice.outstanding, { decimals: true })}</span>
      </div>
      <Input label="Amount received (₹)" name="amount" type="number" step="0.01" min="0" inputMode="decimal" {...form.field("amount")} />
      <Select
        label="Mode"
        name="mode"
        options={PAYMENT_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
        {...form.field("mode")}
      />
      <Input label="Received on" name="receivedAt" type="date" max={todayIST()} {...form.field("receivedAt")} />
      {form.errors._form && <p className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : "Save payment"}
      </Button>
    </form>
  );
}
