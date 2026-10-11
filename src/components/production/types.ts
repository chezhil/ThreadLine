export type FloorWorkOrder = {
  id: string;
  stage: string;
  status: string;
  plannedQty: number;
  producedQty: number;
  order: { id: string; orderNo: string };
};

export type FloorMachine = {
  id: string;
  name: string;
  type: string;
  status: string;
  capacityMetresPerShift: number;
  currentWorkOrder: FloorWorkOrder | null;
  todayMetres: number;
};

export type MachineResponse = {
  machines: FloorMachine[];
  delayRisks: {
    orderId: string;
    orderNo: string;
    deadline: string;
    estimatedDays: number | null;
    daysAvailable: number;
    reason: string;
  }[];
  reorderSuggestions: {
    yarnTypeId: string;
    yarnName: string;
    stockKg: number;
    usageKgPerDay: number;
    daysLeft: number | null;
    reorderKg: number;
  }[];
};

export type WorkOrderRow = {
  id: string;
  stage: string;
  status: string;
  plannedQty: number;
  producedQty: number;
  order: { orderNo: string; status: string };
  machine: { id: string; name: string; status: string };
  _count: { productionLogs: number; rolls: number };
};

export type ProductionMachine = { id: string; name: string; type: string; status: string };

export type WorkOrderResponse = {
  workOrders: WorkOrderRow[];
  orders: { id: string; orderNo: string; status: string }[];
  machines: ProductionMachine[];
};

/** GET /api/work-orders?page=… — one page of work orders plus every open one
 * (for the "record output" dropdown). */
export type PagedWorkOrderResponse = WorkOrderResponse & {
  activeWorkOrders: { id: string; stage: string; order: { orderNo: string }; machine: { name: string } }[];
  total: number;
  page: number;
  pageSize: number;
};

export type ProductionLogRow = {
  id: string;
  shift: string;
  qtyProduced: number;
  loggedAt: string;
  loggedByName: string;
};
