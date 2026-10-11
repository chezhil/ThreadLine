// Client-side shapes of the JSON the roll and dispatch endpoints return
// (dates arrive as ISO strings). Fields only some roles receive (price,
// supplier, invoices, ...) are optional — see roll-view.ts.

export interface BuyerRef {
  id: string;
  name: string;
  contact?: string | null;
}

export interface OrderRef {
  id: string;
  orderNo: string;
  status?: string;
  fabricType: string;
  colour?: string;
  gsm?: number;
  qtyMetres?: number;
  buyerId?: string;
  pricePerMetre?: number;
  buyer?: BuyerRef;
  invoices?: { id: string; invoiceNo: string }[];
  trackingToken?: string;
}

export interface QcRecord {
  id: string;
  result: string;
  defects?: string | null; // JSON-encoded string array
  notes?: string | null;
  inspectorName?: string;
  inspectedAt: string;
  reversal?: { reason: string; createdAt: string; reversedByName?: string; replacementId?: string | null } | null;
}

export interface RollRow {
  id: string;
  rollNo: string;
  qrToken: string;
  qcStatus: string;
  lengthMetres: number;
  weightKg: number;
  shift: string;
  dispatchId: string | null;
  orderId: string;
  yarnLotId: string;
  order: OrderRef;
  machine: { id?: string; name: string; type: string; status?: string; capacityMetresPerShift?: number };
  yarnLot: {
    lotNo: string;
    yarnType?: { name: string; material?: string; count?: string | number; costPerKg?: number };
    supplier?: { name: string };
  };
  qcRecords: QcRecord[];
  dispatch?: { truckNo: string; invoiceId: string | null; dispatchedAt: string } | null;
}

/** GET /api/rolls?view=dispatch — what the dispatch screen needs per roll. */
export type DispatchRoll = Pick<RollRow, "id" | "rollNo" | "qrToken" | "qcStatus" | "lengthMetres" | "weightKg" | "dispatchId" | "orderId" | "order"> & {
  machine: { name: string };
};

export interface DispatchRow {
  id: string;
  truckNo: string;
  invoiceId?: string | null;
  dispatchedAt: string;
  buyer?: BuyerRef;
  rolls?: RollRow[];
}
