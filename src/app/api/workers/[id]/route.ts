import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { workerUpdateSchema } from "@/lib/validation/accounts";
import { fieldErrorResponse, forbidden, notFound, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { archivedAtFor } from "@/lib/validation/common";
import { emitDataChanged } from "@/lib/realtime";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const { id } = await params;
  const before = await db.worker.findUnique({ where: { id } });
  if (!before) return notFound("Worker not found");

  const parsed = workerUpdateSchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));
  const { archived, ...fields } = parsed.data;

  if (fields.name && fields.name !== before.name) {
    const clash = await db.worker.findFirst({ where: { name: fields.name, NOT: { id } } });
    if (clash) return fieldErrorResponse({ name: ["A worker with this name already exists"] }, 409);
  }

  // An archived worker (left the mill) drops off the muster sheet but keeps
  // their attendance history.
  const worker = await db.worker.update({
    where: { id },
    data: { ...fields, archivedAt: archivedAtFor(archived, before.archivedAt) },
  });
  const action = archived === undefined ? "update" : archived ? "archive" : "restore";
  await logAudit("Worker", id, action, before, worker, user.id);
  emitDataChanged({ entity: "Worker", id, action });
  return NextResponse.json({ worker });
}

// Workers with attendance history can't be deleted: their marks are what
// past wages and order costs were computed from.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const { id } = await params;
  const worker = await db.worker.findUnique({
    where: { id },
    include: { _count: { select: { attendance: true } } },
  });
  if (!worker) return notFound("Worker not found");
  if (worker._count.attendance > 0) {
    return fieldErrorResponse(
      {
        _form: [
          `${worker.name} has ${worker._count.attendance} attendance mark(s) that past wages and order costs depend on, so they can't be deleted. Archive them instead to take them off the muster sheet.`,
        ],
      },
      409,
    );
  }

  await db.worker.delete({ where: { id } });
  const { _count, ...snapshot } = worker;
  void _count;
  await logAudit("Worker", id, "delete", snapshot, null, user.id);
  return NextResponse.json({ ok: true });
}
