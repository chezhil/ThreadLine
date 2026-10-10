import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { updateDispatchSchema } from "@/lib/validation/dispatch";
import { handleZodError } from "@/lib/validation/format-errors";
import { logAudit } from "@/lib/audit";
import { emitDataChanged } from "@/lib/realtime";
import { qualityActor } from "@/lib/quality/auth";

// PATCH { truckNo } — corrects a mistyped truck number (owner and
// storekeeper, the roles that load trucks). The rolls, buyer and invoice of a
// dispatch are what left the mill and don't change.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await qualityActor("owner", "storekeeper");
  if ("response" in actor) return actor.response;
  const { id } = await params;
  const parsed = updateDispatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return handleZodError(parsed.error);

  const before = await db.dispatch.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Dispatch not found" }, { status: 404 });
  if (before.truckNo === parsed.data.truckNo) return NextResponse.json(before);

  const dispatch = await db.dispatch.update({ where: { id }, data: { truckNo: parsed.data.truckNo } });
  await logAudit("Dispatch", id, "UPDATE", { truckNo: before.truckNo }, { truckNo: dispatch.truckNo }, actor.user.id);
  emitDataChanged({ entity: "Dispatch", id, action: "update" });
  return NextResponse.json(dispatch);
}
