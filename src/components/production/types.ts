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

export type WorkOrderResponse = {
  workOrders: {
    id: string;
    stage: string;
    status: string;
    plannedQty: number;
    producedQty: number;
    order: { orderNo: string };
    machine: { name: string; status: string };
  }[];
  orders: { id: string; orderNo: string; status: string }[];
  machines: { id: string; name: string; type: string; status: string }[];
};
