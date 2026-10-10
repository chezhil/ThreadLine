"use client";
import { useState } from "react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { useApi, postJson, firstError } from "@/lib/useApi";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import { ErrorNote, Loading } from "@/components/accounts/Stat";
import { YarnTypesTab } from "./YarnTypesTab";
import { YarnLotsTab } from "./YarnLotsTab";
import { SuppliersTab } from "./SuppliersTab";
import type { SupplierRow, YarnLotRow, YarnTypeRow } from "./types";

interface PurchaseRequestRow {
  id: string;
  yarnTypeId: string;
  qtyKg: number;
  status: string;
}

interface LowStockItem {
  yarnTypeId: string;
  name: string;
  colour: string;
  remainingKg: number;
  lowStockThresholdKg: number;
}

const TABS = [
  { id: "stock", label: "Stock" },
  { id: "lots", label: "Yarn lots" },
  { id: "suppliers", label: "Suppliers" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const INVENTORY_ENTITIES = new Set(["YarnType", "YarnLot", "Supplier", "OrderYarnReservation"]);

export function InventoryClient() {
  const [tab, setTab] = useState<Tab>("stock");
  const yarnTypes = useApi<{ yarnTypes: YarnTypeRow[] }>("/api/yarn-types");
  const lots = useApi<{ yarnLots: YarnLotRow[] }>("/api/yarn-lots");
  const suppliers = useApi<{ suppliers: SupplierRow[] }>("/api/suppliers");
  const lowStock = useApi<{ lowStock: LowStockItem[] }>("/api/yarn/low-stock");
  const purchaseRequests = useApi<{ requests: PurchaseRequestRow[] }>("/api/purchase-requests");
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{ yarnTypeId: string; message: string } | null>(null);

  function refreshStock() {
    yarnTypes.refetch();
    lots.refetch();
    lowStock.refetch();
  }
  function refreshAll() {
    refreshStock();
    suppliers.refetch();
  }

  async function requestMore(item: LowStockItem) {
    // Enough to get back to twice the threshold.
    const suggestedKg = Math.max(1, Math.round(item.lowStockThresholdKg * 2 - item.remainingKg));
    setRequesting(item.yarnTypeId);
    setRequestError(null);
    const result = await postJson("/api/purchase-requests", { yarnTypeId: item.yarnTypeId, qtyKg: suggestedKg });
    setRequesting(null);
    if (!result.ok) setRequestError({ yarnTypeId: item.yarnTypeId, message: firstError(result, "Couldn't raise the request") });
    purchaseRequests.refetch();
  }

  const pendingRequestFor = (yarnTypeId: string) =>
    purchaseRequests.data?.requests.find((r) => r.yarnTypeId === yarnTypeId && r.status === "PENDING");

  useRealtimeEvent(RealtimeEvents.StockChanged, refreshStock);
  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if (INVENTORY_ENTITIES.has(change.entity)) refreshAll();
  });

  const loadError = yarnTypes.error ?? lots.error ?? suppliers.error;
  const typeRows = yarnTypes.data?.yarnTypes;
  const lotRows = lots.data?.yarnLots;
  const supplierRows = suppliers.data?.suppliers;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Inventory & Purchase</h1>
        <p className="text-sm text-gray-500">Yarn stock, intake and suppliers.</p>
      </div>

      {lowStock.data && lowStock.data.lowStock.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader title="Low stock" />
          <ul className="flex flex-col gap-2 text-sm text-amber-800">
            {lowStock.data.lowStock.map((item) => {
              const pending = pendingRequestFor(item.yarnTypeId);
              return (
                <li key={item.yarnTypeId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {item.name} ({item.colour}): {item.remainingKg.toFixed(1)}kg left — threshold {item.lowStockThresholdKg}kg
                  </span>
                  {pending ? (
                    <span className="flex items-center gap-1 text-xs">
                      {pending.qtyKg} kg requested <Badge status="pending" />
                    </span>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={requesting === item.yarnTypeId} onClick={() => requestMore(item)}>
                      {requesting === item.yarnTypeId ? "Requesting…" : "Request more"}
                    </Button>
                  )}
                  {requestError?.yarnTypeId === item.yarnTypeId && (
                    <p role="alert" className="w-full text-xs text-red-700">
                      {requestError.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <div role="tablist" aria-label="Inventory sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`inventory-tab-${t.id}`}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`inventory-panel-${t.id}`}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${tab === t.id ? "border-b-2 border-brand text-brand" : "text-gray-500"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`inventory-panel-${tab}`} aria-labelledby={`inventory-tab-${tab}`}>
        {loadError && <ErrorNote message={`Couldn't load inventory: ${loadError}`} onRetry={refreshAll} />}
        {!(typeRows && lotRows && supplierRows) && !loadError && <Loading />}
        {typeRows && lotRows && supplierRows && (
          <>
            {tab === "stock" && <YarnTypesTab yarnTypes={typeRows} onChanged={refreshStock} />}
            {tab === "lots" && <YarnLotsTab lots={lotRows} yarnTypes={typeRows} suppliers={supplierRows} onChanged={refreshAll} />}
            {tab === "suppliers" && <SuppliersTab suppliers={supplierRows} onChanged={refreshAll} />}
          </>
        )}
      </div>
    </div>
  );
}
