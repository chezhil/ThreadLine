import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { yarnTypeSchema } from "@/lib/validation/yarn";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";

// Archived yarn types are listed too (flagged) so they can be restored; the
// intake and order forms leave them out.
export async function GET() {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const yarnTypes = await db.yarnType.findMany({
    include: { lots: true, _count: { select: { lots: true, purchaseRequests: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ yarnTypes });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner", "storekeeper");
  if (!user) return forbidden();

  const parsed = yarnTypeSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const { name, count, colour } = parsed.data;
  if (await db.yarnType.findFirst({ where: { name, count, colour } })) {
    return fieldErrorResponse({ name: [`${name} ${count} in ${colour} already exists`] }, 409);
  }

  const yarnType = await db.yarnType.create({ data: parsed.data });
  await logAudit("YarnType", yarnType.id, "create", null, yarnType, user.id);
  return NextResponse.json({ yarnType }, { status: 201 });
}
