import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { computeCosting, ordersInProgressIn, ordersRealisedIn, rollCostsForOrder } from "@/lib/accounts/costing";
import { fieldErrorResponse, forbidden, notFound, zodFieldErrors } from "@/lib/accounts/http";
import { monthQuerySchema } from "@/lib/validation/accounts";

// GET                      → every order's cost, revenue and profit
// GET ?month=YYYY-MM       → orders booked that month (finished shipping) + work in progress active that month
// GET ?orderId=…           → one order, with cost per roll
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const sp = req.nextUrl.searchParams;
  const monthParsed = monthQuerySchema.safeParse(sp.get("month") ?? undefined);
  if (!monthParsed.success) return fieldErrorResponse(zodFieldErrors(monthParsed.error));

  const { orders, pools } = await computeCosting();

  const orderId = sp.get("orderId");
  if (orderId) {
    const order = orders.find((o) => o.orderId === orderId || o.orderNo === orderId);
    if (!order) return notFound("Order not found");
    return NextResponse.json({ order, rolls: await rollCostsForOrder(order), pools });
  }

  const month = monthParsed.data;
  if (!month) return NextResponse.json({ orders, pools });
  return NextResponse.json({
    month,
    realised: ordersRealisedIn(orders, month),
    inProgress: ordersInProgressIn(orders, month),
    pool: pools[month] ?? null,
  });
}
