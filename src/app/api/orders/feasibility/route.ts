import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { feasibilityRequestSchema } from "@/lib/validation/order";
import { checkFeasibility } from "@/lib/feasibility";

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = feasibilityRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const result = await checkFeasibility(parsed.data);
  return NextResponse.json(result);
}
