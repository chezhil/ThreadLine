import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { supplierSchema } from "@/lib/validation/yarn";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";

// Archived suppliers are listed too (flagged); the intake form leaves them out.
export async function GET() {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const suppliers = await db.supplier.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { yarnLots: true } } },
  });
  return NextResponse.json({ suppliers });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const parsed = supplierSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const clash = await db.supplier.findFirst({ where: { name: parsed.data.name } });
  if (clash) return fieldErrorResponse({ name: ["A supplier with this name already exists"] }, 409);

  const supplier = await db.supplier.create({ data: parsed.data });
  await logAudit("Supplier", supplier.id, "create", null, supplier, user.id);
  return NextResponse.json({ supplier }, { status: 201 });
}
