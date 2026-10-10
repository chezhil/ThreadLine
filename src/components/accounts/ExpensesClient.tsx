"use client";
import { useMemo, useState } from "react";
import { Button, Drawer, EmptyState, Input, Select, Table } from "@/components/ui";
import { postJson, useApi } from "@/lib/useApi";
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
}

export function ExpensesClient() {
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data, loading, error, refetch } = useApi<{
    expenses: ExpenseRow[];
    totals: { total: number; byCategory: Record<string, number> };
  }>(`/api/expenses?month=${month}${category ? `&category=${category}` : ""}`);

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
              { header: "Date", render: (e: ExpenseRow) => dateIN(e.date) },
              { header: "Category", render: (e) => EXPENSE_CATEGORY_LABEL[e.category] ?? e.category },
              { header: "Note", className: "max-w-xs truncate", render: (e) => <span title={e.note ?? ""}>{e.note ?? "—"}</span> },
              { header: "Order", render: (e) => e.orderNo ?? <span className="text-gray-400">Shared</span> },
              { header: "Amount", className: "text-right tabular-nums", render: (e) => inr(e.amount, { decimals: true }) },
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
    </div>
  );
}

function ExpenseForm({ onSaved }: { onSaved: () => void }) {
  const orders = useApi<{ orders: { id: string; orderNo: string; buyer: { name: string } }[] }>("/api/orders");
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
