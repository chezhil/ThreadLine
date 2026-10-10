import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { workerSchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";

export async function GET() {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const workers = await db.worker.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { attendance: true } } },
  });
  return NextResponse.json({ workers });
}

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = workerSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const clash = await db.worker.findFirst({ where: { name: parsed.data.name } });
  if (clash) return fieldErrorResponse({ name: ["A worker with this name already exists"] }, 409);

  const worker = await db.worker.create({ data: parsed.data });
  await logAudit("Worker", worker.id, "create", null, worker, user.id);
  return NextResponse.json({ worker }, { status: 201 });
}
