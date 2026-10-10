import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { machineEditSchema, productionIdSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { refreshProductionAlerts } from "@/lib/production/insights";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  if (!productionIdSchema.safeParse(params.id).success) return problem("Invalid machine identifier", 400, "id");
  const parsed = machineEditSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const before = await db.machine.findUnique({ where: { id: params.id } });
  if (!before) return problem("Machine not found", 404);
  if (parsed.data.name && parsed.data.name !== before.name) {
    const duplicate = await db.machine.findFirst({ where: { name: parsed.data.name } });
    if (duplicate) return problem("A machine with this name already exists", 400, "name");
  }
  if (parsed.data.type && parsed.data.type !== before.type) {
    const assigned = await db.workOrder.count({ where: { machineId: before.id } });
    if (assigned) return problem("A machine with work order history cannot change type", 400, "type");
  }
  const machine = await db.machine.update({ where: { id: before.id }, data: parsed.data });
  await logAudit("Machine", machine.id, "UPDATE", before, machine, actor.user.id);
  await emit("machine:status", { machineId: machine.id, status: machine.status, updated: true });
  await refreshProductionAlerts(db);
  return NextResponse.json(machine);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  if (!productionIdSchema.safeParse(params.id).success) return problem("Invalid machine identifier", 400, "id");
  if (actor.user.role !== "owner") return problem("Only an owner can remove a machine", 403);
  const before = await db.machine.findUnique({ where: { id: params.id } });
  if (!before) return problem("Machine not found", 404);
  const [workOrders, productionLogs, rolls, attendance, maintenance] = await Promise.all([
    db.workOrder.count({ where: { machineId: before.id } }),
    db.productionLog.count({ where: { machineId: before.id } }),
    db.roll.count({ where: { machineId: before.id } }),
    // Attendance marks point at the machine an operator ran; deleting it
    // would silently move their wages from direct to indirect labour.
    db.attendance.count({ where: { machineId: before.id } }),
    db.maintenanceRequest.count({ where: { machineId: before.id } }),
  ]);
  if (workOrders || productionLogs || rolls || attendance || maintenance) return problem("Machine has production history and cannot be removed", 409);
  await db.machine.delete({ where: { id: before.id } });
  await logAudit("Machine", before.id, "DELETE", before, null, actor.user.id);
  await emit("machine:status", { machineId: before.id, deleted: true });
  return NextResponse.json({ deleted: true });
}
