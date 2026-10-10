import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { EXPENSE_CATEGORIES, expenseSchema, monthQuerySchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, readJson, round2, zodFieldErrors } from "@/lib/accounts/http";
import { currentMonthKey, istMidnight, monthRange } from "@/lib/accounts/period";
import { expenseCategoryToLedgerType, postLedgerEntry } from "@/lib/ledger";
import { writeTransaction } from "@/lib/concurrency";

// GET ?month=YYYY-MM[&category=power][&orderId=…]
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const sp = req.nextUrl.searchParams;
  const monthParsed = monthQuerySchema.safeParse(sp.get("month") ?? undefined);
  if (!monthParsed.success) return fieldErrorResponse(zodFieldErrors(monthParsed.error));
  const category = sp.get("category");
  if (category && !(EXPENSE_CATEGORIES as readonly string[]).includes(category)) {
    return fieldErrorResponse({ category: ["Unknown category"] });
  }
  const month = monthParsed.data ?? currentMonthKey();
  const { start, end } = monthRange(month);

  const expenses = await db.expense.findMany({
    where: {
      date: { gte: start, lt: end },
      ...(category ? { category } : {}),
      ...(sp.get("orderId") ? { orderId: sp.get("orderId") } : {}),
    },
    orderBy: [{ date: "desc" }, { id: "asc" }],
  });
  const orderIds = [...new Set(expenses.map((e) => e.orderId).filter((id): id is string => !!id))];
  const orders = await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } });
  const orderNo = new Map(orders.map((o) => [o.id, o.orderNo]));

  const byCategory: Record<string, number> = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0]));
  for (const e of expenses) byCategory[e.category] += e.amount;

  return NextResponse.json({
    month,
    expenses: expenses.map((e) => ({ ...e, orderNo: e.orderId ? orderNo.get(e.orderId) ?? null : null })),
    totals: {
      total: round2(expenses.reduce((s, e) => s + e.amount, 0)),
      byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, round2(v)])),
    },
  });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = expenseSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  if (parsed.data.orderId) {
    const order = await db.order.findUnique({ where: { id: parsed.data.orderId }, select: { id: true } });
    if (!order) return fieldErrorResponse({ orderId: ["Order not found"] });
  }

  const date = istMidnight(parsed.data.date);
  const expense = await writeTransaction(async (tx) => {
    const created = await tx.expense.create({ data: { ...parsed.data, date } });
    await postLedgerEntry(tx, {
      date,
      type: expenseCategoryToLedgerType(created.category),
      amount: created.amount,
      sourceType: "Expense",
      sourceId: created.id,
      orderId: created.orderId,
    });
    return created;
  });
  await logAudit("Expense", expense.id, "create", null, expense, user.id);
  return NextResponse.json({ expense }, { status: 201 });
}
