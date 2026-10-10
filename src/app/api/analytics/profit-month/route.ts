import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { fieldErrorResponse, forbidden, zodFieldErrors } from "@/lib/accounts/http";
import { currentMonthKey } from "@/lib/accounts/period";
import { monthSummary } from "@/lib/accounts/summary";
import { monthQuerySchema } from "@/lib/validation/accounts";

// GET ?month=YYYY-MM (defaults to the current month, IST)
export async function GET(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = monthQuerySchema.safeParse(req.nextUrl.searchParams.get("month") ?? undefined);
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  return NextResponse.json(await monthSummary(parsed.data ?? currentMonthKey()));
}
