import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { machineStatusChangeSchema, productionIdSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { refreshProductionAlerts } from "@/lib/production/insights";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  if (!productionIdSchema.safeParse(params.id).success) return problem("Invalid machine identifier", 400, "id");
  const parsed = machineStatusChangeSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const before = await db.machine.findUnique({ where: { id: params.id } });
  if (!before) return problem("Machine not found", 404);
  if (before.status === parsed.data.status) return NextResponse.json(before);
  const machine = await db.machine.update({ where: { id: params.id }, data: { status: parsed.data.status } });
  await logAudit("Machine", machine.id, "STATUS_CHANGE", before.status, machine.status, actor.user.id);
  await emit("machine:status", { machineId: machine.id, status: machine.status });
  await refreshProductionAlerts(db);
  return NextResponse.json(machine);
}
