import type { PrismaClient } from "@prisma/client";

// Production module seed section. The foundation's seed runner should call
// seedProduction(db) after it creates buyers, yarn lots, reservations and orders.
export async function seedProduction(db: PrismaClient) {
  const machineRows = [
    { name: "Spinning 1", type: "spinning", status: "RUNNING", capacityMetresPerShift: 320 },
    { name: "Spinning 2", type: "spinning", status: "IDLE", capacityMetresPerShift: 280 },
    { name: "Loom 1", type: "loom", status: "RUNNING", capacityMetresPerShift: 240 },
    { name: "Loom 2", type: "loom", status: "RUNNING", capacityMetresPerShift: 220 },
    { name: "Loom 3", type: "loom", status: "IDLE", capacityMetresPerShift: 210 },
    { name: "Loom 4", type: "loom", status: "BREAKDOWN", capacityMetresPerShift: 200 },
    { name: "Dyeing 1", type: "dyeing", status: "RUNNING", capacityMetresPerShift: 250 },
    { name: "Dyeing 2", type: "dyeing", status: "MAINTENANCE", capacityMetresPerShift: 230 },
  ];
  for (const row of machineRows) {
    const existing = await db.machine.findFirst({ where: { name: row.name } });
    if (!existing) await db.machine.create({ data: row });
  }
  const machines = await db.machine.findMany({ where: { name: { in: machineRows.map((row) => row.name) } } });
  const machineByName = new Map<string, string>(machines.map((machine) => [machine.name, machine.id]));
  const orders = await db.order.findMany({
    where: { status: { in: ["CONFIRMED", "IN_PRODUCTION", "QC", "READY"] } },
    include: { reservations: true },
    orderBy: { orderNo: "asc" },
    take: 10,
  });
  const seededUser = await db.user.findFirst({ where: { role: "floor_supervisor" } });
  const stageMachines = { spinning: "Spinning 2", weaving: "Loom 3", dyeing: "Dyeing 2" } as const;
  async function ensureWorkOrder(orderId: string, plannedQty: number, stage: keyof typeof stageMachines, machineName: string, fraction: number) {
    const existing = await db.workOrder.findFirst({ where: { orderId, stage } });
    if (existing) return;
    const machineId = machineByName.get(machineName);
    if (!machineId) return;
    const producedQty = Math.round(plannedQty * fraction);
    const completed = fraction === 1;
    const workOrder = await db.workOrder.create({
      data: { orderId, stage, machineId, plannedQty, producedQty, status: completed ? "COMPLETED" : "IN_PROGRESS", startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), finishedAt: completed ? new Date(Date.now() - 24 * 60 * 60 * 1000) : null },
    });
    if (producedQty > 0 && seededUser) {
      await db.productionLog.create({ data: { workOrderId: workOrder.id, machineId, shift: "Morning", qtyProduced: producedQty, loggedAt: completed ? new Date(Date.now() - 24 * 60 * 60 * 1000) : new Date(), loggedBy: seededUser.id } });
    }
  }

  const activeOrders = orders.filter((order) => order.status === "IN_PRODUCTION" || (order.status === "CONFIRMED" && order.reservations.length > 0)).slice(0, 4);
  const activePlan = [
    { stage: "spinning", machine: "Spinning 1", fraction: 0.55 },
    { stage: "weaving", machine: "Loom 1", fraction: 0.38 },
    { stage: "dyeing", machine: "Dyeing 1", fraction: 0.2 },
    { stage: "weaving", machine: "Loom 4", fraction: 0.3 },
  ] as const;
  const stages = ["spinning", "weaving", "dyeing"] as const;
  for (const [index, order] of activeOrders.entries()) {
    const assignment = activePlan[index];
    if (order.status === "CONFIRMED") await db.order.update({ where: { id: order.id }, data: { status: "IN_PRODUCTION" } });
    for (const stage of stages) {
      if (stage === assignment.stage) {
        await ensureWorkOrder(order.id, order.qtyMetres, stage, assignment.machine, assignment.fraction);
        break;
      }
      await ensureWorkOrder(order.id, order.qtyMetres, stage, stageMachines[stage], 1);
    }
  }

  const completedOrder = orders.find((order) => order.status === "QC" || order.status === "READY");
  if (completedOrder) {
    for (const stage of stages) {
      await ensureWorkOrder(completedOrder.id, completedOrder.qtyMetres, stage, stageMachines[stage], 1);
    }
  }
}
