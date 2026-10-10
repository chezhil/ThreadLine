import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { emit } from "@/lib/realtime";
import { machineSchema } from "@/lib/validation/production";
import { productionActor } from "@/lib/production/auth";
import { fieldError, jsonBody, problem } from "@/lib/production/http";
import { millDayRange, productionInsights } from "@/lib/production/insights";

export async function GET() {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const { start, end } = millDayRange();
  const [machines, insights] = await Promise.all([
    db.machine.findMany({
      orderBy: { name: "asc" },
      include: {
        workOrders: {
          where: { status: { not: "COMPLETED" } },
          include: { order: { select: { id: true, orderNo: true } } },
          orderBy: { startedAt: "desc" },
        },
        productionLogs: { where: { loggedAt: { gte: start, lt: end } }, select: { qtyProduced: true } },
      },
    }),
    productionInsights(db),
  ]);
  return NextResponse.json({
    machines: machines.map((machine) => ({
      id: machine.id,
      name: machine.name,
      type: machine.type,
      status: machine.status,
      capacityMetresPerShift: machine.capacityMetresPerShift,
      currentWorkOrder: machine.workOrders[0] ?? null,
      todayMetres: machine.productionLogs.reduce((sum, log) => sum + log.qtyProduced, 0),
    })),
    ...insights,
  });
}

export async function POST(request: Request) {
  const actor = await productionActor();
  if ("response" in actor) return actor.response;
  const parsed = machineSchema.safeParse(await jsonBody(request));
  if (!parsed.success) return fieldError(parsed.error);
  const exists = await db.machine.findFirst({ where: { name: parsed.data.name } });
  if (exists) return problem("A machine with this name already exists", 400, "name");
  const machine = await db.machine.create({ data: parsed.data });
  await logAudit("Machine", machine.id, "CREATE", null, machine, actor.user.id);
  await emit("machine:status", { machineId: machine.id, status: machine.status, created: true });
  return NextResponse.json(machine, { status: 201 });
}
