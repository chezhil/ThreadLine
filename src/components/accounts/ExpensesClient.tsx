"use client";
import { useMemo, useState } from "react";
import { Button, Drawer, EmptyState, Input, Select, Table, Textarea } from "@/components/ui";
import { firstError, postJson, useApi } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import { currentMonthKey } from "@/lib/accounts/period";
import { EXPENSE_CATEGORY_LABEL, dateIN, inr, todayIST } from "@/lib/accounts/format";
import { EXPENSE_CATEGORIES, expenseSchema } from "@/lib/validation/accounts";
import { MonthPicker } from "./MonthPicker";
import { ErrorNote, Loading, PageTitle, Stat } from "./Stat";
import { useZodForm } from "./useZodForm";

interface ExpenseRow {
  id: string;
  category: string;
  amount: number;
  date: string;
  orderId: string | null;
  orderNo: string | null;
  note: string | null;
  isPayout: boolean;
  reversal: { reason: string; createdAt: string; replacementId: string | null } | null;
}

export function ExpensesClient() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [reverseFor, setReverseFor] = useState<ExpenseRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const { data, loading, error, refetch } = useApi<{
    expenses: ExpenseRow[];
    totals: { total: number; byCategory: Record<string, number> };
  }>(`/api/expenses?month=${month}${category ? `&category=${category}` : ""}`);

  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if (change.entity === "Expense") refetch();
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.expenses ?? []).filter(
      (e) => !needle || (e.note ?? "").toLowerCase().includes(needle) || (e.orderNo ?? "").toLowerCase().includes(needle),
    );
  }, [data, q]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Expenses"
        subtitle="Raw-material bills, power, overhead and wage payouts. Power and overhead are spread onto orders by machine-shift; bills linked to an order are charged to it directly."
        action={
          <div className="flex items-center gap-2">
            <MonthPicker month={month} onChange={setMonth} max={thisMonth} />
            <Button onClick={() => setOpen(true)}>Add expense</Button>
          </div>
        }
      />

      {flash && (
        <div role="status" className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          {flash}
        </div>
      )}
      {error && <ErrorNote message={`Couldn't load expenses: ${error}`} onRetry={refetch} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Stat label={category ? `Total (${category})` : "Total"} value={inr(data.totals.total)} />
            {EXPENSE_CATEGORIES.map((c) => (
              <Stat key={c} label={EXPENSE_CATEGORY_LABEL[c]} value={inr(data.totals.byCategory[c])} />
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input aria-label="Search expenses" placeholder="Search note or order no." value={q} onChange={(e) => setQ(e.target.value)} />
            <Select
              aria-label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={[{ value: "", label: "All categories" }, ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] }))]}
            />
          </div>

          <Table
            columns={[
              {
                header: "Date",
                render: (e: ExpenseRow) => (
                  <>
                    <span className={e.reversal ? "text-gray-500" : ""}>{dateIN(e.date)}</span>
                    {e.reversal && (
                      <span className="block text-xs text-gray-500">
                        Reversed {dateIN(e.reversal.createdAt)}: {e.reversal.reason}
                      </span>
                    )}
                  </>
                ),
              },
              { header: "Category", render: (e) => <span className={e.reversal ? "text-gray-500" : ""}>{EXPENSE_CATEGORY_LABEL[e.category] ?? e.category}</span> },
              {
                header: "Note",
                className: "max-w-xs truncate",
                render: (e) => (
                  <span className={e.reversal ? "text-gray-500" : ""} title={e.note ?? ""}>
                    {e.note ?? "—"}
                    {e.isPayout && <span className="ml-1 text-xs text-gray-400">(payout)</span>}
                  </span>
                ),
              },
              { header: "Order", render: (e) => e.orderNo ?? <span className="text-gray-400">Shared</span> },
              {
                header: "Amount",
                className: "text-right tabular-nums",
                render: (e) => <span className={e.reversal ? "text-gray-500 line-through" : ""}>{inr(e.amount, { decimals: true })}</span>,
              },
              {
                header: "",
                render: (e) =>
                  !e.reversal && !e.isPayout ? (
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setReverseFor(e)}>
                        Reverse
                      </Button>
                    </div>
                  ) : null,
              },
            ]}
            rows={rows}
            keyFor={(e) => e.id}
            emptyState={<EmptyState title="No expenses for this month" description="Add the month's bills to get true costs." action={<Button size="sm" onClick={() => setOpen(true)}>Add expense</Button>} />}
          />
        </>
      )}

      <Drawer open={open} onClose={() => setOpen(false)} title="Add expense">
        {open && (
          <ExpenseForm
            onSaved={() => {
              setOpen(false);
              refetch();
            }}
          />
        )}
      </Drawer>

      <Drawer open={!!reverseFor} onClose={() => setReverseFor(null)} title="Reverse / correct expense">
        {reverseFor && (
          <ReverseExpenseForm
            key={reverseFor.id}
            expense={reverseFor}
            onSaved={(msg) => {
              setReverseFor(null);
              setFlash(msg);
              refetch();
            }}
          />
        )}
      </Drawer>
    </div>
  );
}

function ExpenseForm({ onSaved }: { onSaved: () => void }) {
  const orders = useApi<{ orders: { id: string; orderNo: string; buyer: { name: string } }[] }>("/api/orders?view=options");
  const form = useZodForm(expenseSchema, { category: "", amount: "", date: todayIST(), orderId: "", note: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.validate()) return;
    form.setSubmitting(true);
    const res = await postJson("/api/expenses", form.values);
    form.setSubmitting(false);
    if (!res.ok) {
      form.setErrors(res.fieldErrors ?? { _form: ["Couldn't save the expense"] });
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <Select
        label="Category"
        name="category"
        placeholder="Select category"
        options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] }))}
        {...form.field("category")}
      />
      <Input label="Amount (₹)" name="amount" type="number" step="0.01" min="0" inputMode="decimal" {...form.field("amount")} />
      <Input label="Bill date" name="date" type="date" max={todayIST()} {...form.field("date")} />
      <Select
        label="Charge to order (optional)"
        name="orderId"
        options={[
          { value: "", label: "Shared — spread across the month's production" },
          ...(orders.data?.orders ?? []).map((o) => ({ value: o.id, label: `${o.orderNo} — ${o.buyer.name}` })),
        ]}
        {...form.field("orderId")}
      />
      {form.values.category === "yarn" && form.values.orderId && (
        <p className="text-xs text-amber-700">
          Yarn in rolls is already costed from lot prices. Link a yarn bill to an order only for yarn bought outside the stock lots, or it will be counted twice.
        </p>
      )}
      <Input label="Note (bill no., vendor, what for)" name="note" maxLength={200} {...form.field("note")} />
      {form.errors._form && <p className="text-sm text-red-600">{form.errors._form[0]}</p>}
      <Button type="submit" disabled={form.submitting}>
        {form.submitting ? "Saving…" : "Save expense"}
      </Button>
    </form>
  );
}

function ReverseExpenseForm({ expense, onSaved }: { expense: ExpenseRow; onSaved: (message: string) => void }) {
  const orders = useApi<{ orders: { id: string; orderNo: string; buyer: { name: string } }[] }>("/api/orders?view=options");
  const [reason, setReason] = useState("");
  const [correct, setCorrect] = useState(false);
  const [category, setCategory] = useState(expense.category);
  const [amount, setAmount] = useState(String(expense.amount));
  const [date, setDate] = useState(expense.date.slice(0, 10));
  const [orderId, setOrderId] = useState(expense.orderId ?? "");
  const [note, setNote] = useState(expense.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError("Say why this is being reversed");
      return;
    }
    setError(null);
    setSubmitting(true);
    const body: { reason: string; correction?: Record<string, unknown> } = { reason };
    if (correct) body.correction = { category, amount: Number(amount), date, orderId: orderId || null, note: note || null };
    const res = await postJson(`/api/expenses/${expense.id}/reversal`, body);
    setSubmitting(false);
    if (!res.ok) {
      setError(firstError(res, "Couldn't reverse the expense"));
      return;
    }
    onSaved(correct ? "Expense reversed and the correction recorded." : "Expense reversed.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
        {EXPENSE_CATEGORY_LABEL[expense.category] ?? expense.category} · {inr(expense.amount, { decimals: true })} · {dateIN(expense.date)}
        {expense.note && <span> · {expense.note}</span>}
      </div>
      <Textarea label="Reason" name="reason" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={correct} onChange={(e) => setCorrect(e.target.checked)} />
        Record the corrected bill in the same step
      </label>
      {correct && (
        <>
          <Select
            label="Category"
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABEL[c] }))}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <Input label="Amount (₹)" type="number" step="0.01" min="0" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input label="Bill date" type="date" max={todayIST()} value={date} onChange={(e) => setDate(e.target.value)} />
          <Select
            label="Charge to order (optional)"
            options={[
              { value: "", label: "Shared — spread across the month's production" },
              ...(orders.data?.orders ?? []).map((o) => ({ value: o.id, label: `${o.orderNo} — ${o.buyer.name}` })),
            ]}
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
          />
          <Input label="Note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" variant="danger" disabled={submitting}>
        {submitting ? "Reversing…" : "Reverse expense"}
      </Button>
    </form>
  );
}
