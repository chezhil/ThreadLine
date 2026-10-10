import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { writeTransaction } from "@/lib/concurrency";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { productionIdSchema, productionLogUpdateSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { refreshProductionAlerts } from "@/lib/production/insights";
import { CorrectionRefused, correctProductionLog, type LogCorrection } from "@/lib/production/corrections";
import { recordStatusChanges } from "@/lib/order-status";

type Ctx = { params: Promise<{ id: string }> };

// PATCH { qtyProduced?, shift? } and DELETE — correct a mistyped output entry
// (owner and floor supervisor). See lib/production/corrections.ts for what a
// correction may change and when it is refused.
export async function PATCH(request: Request, context: Ctx) {
  const { id } = await context.params;
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  if (!productionIdSchema.safeParse(id).success) return problem("Invalid production log identifier", 400, "id");
  const parsed = productionLogUpdateSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const current = await db.productionLog.findUnique({ where: { id }, select: { qtyProduced: true } });
  if (!current) return problem("Production log not found", 404);
  return applyCorrection(id, { qtyProduced: parsed.data.qtyProduced ?? current.qtyProduced, shift: parsed.data.shift, remove: false }, actor.user.id);
}

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  if (!productionIdSchema.safeParse(id).success) return problem("Invalid production log identifier", 400, "id");
  return applyCorrection(id, { qtyProduced: 0, remove: true }, actor.user.id);
}

async function applyCorrection(id: string, correction: LogCorrection, userId: string) {
  let result;
  try {
    result = await writeTransaction((tx) => correctProductionLog(tx, id, correction));
  } catch (error) {
    if (error instanceof CorrectionRefused) return problem(error.message, error.status, error.field === "_form" ? undefined : error.field);
    throw error;
  }
  if (!result) return problem("Production log not found", 404);

  // The correction is committed; a failing follow-up must not turn it into a
  // 500 that invites a second, double-applied correction.
  try {
    await logAudit("ProductionLog", id, correction.remove ? "DELETE" : "UPDATE", result.before, result.after, userId);
    await logAudit("WorkOrder", result.workOrder.id, "PROGRESS", String(result.workOrder.from), String(result.workOrder.to), userId);
    await recordStatusChanges([result.statusChange], userId);
    emit("machine:status", { machineId: result.machineId, status: result.machineStatus, outputChanged: true });
    await refreshProductionAlerts(db);
  } catch (sideEffectError) {
    console.error("Production log corrected; follow-up step failed:", sideEffectError);
  }
  return correction.remove ? NextResponse.json({ deleted: true }) : NextResponse.json({ ...result.after, producedQty: result.workOrder.to });
}
