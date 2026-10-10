// Row shapes of the inventory APIs, as the screens read them.

export interface YarnLotRow {
  id: string;
  lotNo: string;
  yarnTypeId: string;
  supplierId: string;
  qtyReceivedKg: number;
  qtyRemainingKg: number;
  receivedAt: string;
  linkedOrderId: string | null;
  linkedOrderNo: string | null;
  yarnType: { name: string; colour: string; count: string };
  supplier: { name: string };
  _count: { reservations: number; rolls: number };
}

export interface YarnTypeRow {
  id: string;
  name: string;
  count: string;
  material: string;
  colour: string;
  lowStockThresholdKg: number;
  costPerKg: number;
  archivedAt: string | null;
  lots: { qtyRemainingKg: number }[];
  _count: { lots: number; purchaseRequests: number };
}

export interface SupplierRow {
  id: string;
  name: string;
  contact: string;
  gstin: string | null;
  archivedAt: string | null;
  _count: { yarnLots: number };
}

export const yarnLabel = (t: { name: string; colour: string }) => `${t.name} — ${t.colour}`;
