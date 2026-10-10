import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { fieldErrorResponse, forbidden } from "@/lib/accounts/http";
import { machineOutput } from "@/lib/accounts/machine-output";

// GET ?days=7 (1–90): output per machine from ProductionLog rows
export async function GET(req: NextRequest) {
  const user = await requireRole("owner", "floor_supervisor");
  if (!user) return forbidden();

  const raw = req.nextUrl.searchParams.get("days") ?? "7";
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    return fieldErrorResponse({ days: ["days must be a whole number from 1 to 90"] });
  }
  return NextResponse.json(await machineOutput(days));
}
