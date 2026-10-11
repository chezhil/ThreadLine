"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { Button } from "@/components/quality/ui/Button";
import { Pager } from "@/components/ui";
import { Badge } from "@/components/quality/ui/Badge";
import { Card } from "@/components/quality/ui/Card";
import { Input } from "@/components/quality/ui/Input";
import { Select } from "@/components/quality/ui/Select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/quality/ui/Table";
import { EmptyState } from "@/components/quality/ui/EmptyState";
import { Drawer } from "@/components/quality/ui/Drawer";
import {
  Layers,
  Plus,
  Printer,
  Scan,
  Search,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RollRow } from "@/lib/quality/types";

// The QR decoder (jsqr) and camera wiring only matter once the scan sheet is
// open, so keep them out of this page's initial bundle.
const QrScannerModal = dynamic(() => import("@/components/rolls/QrScannerModal").then((m) => m.QrScannerModal), { ssr: false });

// The label pulls in the qrcode encoder; it's only shown in the print modal.
const RollLabelModal = dynamic(() => import("@/components/rolls/RollLabelModal").then((m) => m.RollLabelModal), { ssr: false });

const PAGE_SIZE = 50;

export default function RollsListPage() {
  const router = useRouter();
  const [rolls, setRolls] = useState<RollRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isMintOpen, setIsMintOpen] = useState(false);
  const [selectedRollForPrint, setSelectedRollForPrint] = useState<RollRow | null>(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Mint Form State
  const [mintData, setMintData] = useState({
    orderId: "",
    workOrderId: "",
    machineId: "",
    shift: "Morning (Shift A)",
    yarnLotId: "",
    lengthMetres: "800",
    weightKg: "185",
  });
  const [submittingMint, setSubmittingMint] = useState(false);
  const [mintErrors, setMintErrors] = useState<Record<string, string>>({});

  // Dropdown source: weaving work orders, each with its order, loom and the
  // yarn lots reserved for that order (GET /api/rolls/mint-options).
  const [mintOptions, setMintOptions] = useState<MintWorkOrder[]>([]);
  const [mintOptionsError, setMintOptionsError] = useState<string | null>(null);
  const selectedWorkOrder = mintOptions.find((w) => w.id === mintData.workOrderId);

  // Reload by bumping the key; the fetch itself lives inside the effect.
  const [reloadKey, setReloadKey] = useState(0);
  const fetchRolls = () => setReloadKey((k) => k + 1);

  // Search resets back to page 1 — a stale page number past the end of a
  // newly-narrowed result set would otherwise just show an empty table.
  const setSearchAndResetPage = (next: string) => { setSearch(next); setPage(1); };

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search.trim()) params.set("search", search.trim());
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/rolls?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setRolls(data.rolls);
          setTotal(data.total);
        }
      } catch (err) {
        console.warn("Failed to fetch rolls:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reloadKey, page, search]);
  useRealtimeEvent(RealtimeEvents.RollCreated, () => {
    fetchRolls();
  });
  useRealtimeEvent(RealtimeEvents.QcCompleted, () => {
    fetchRolls();
  });
  useRealtimeEvent(RealtimeEvents.DispatchCompleted, () => {
    fetchRolls();
  });

  const pickWorkOrder = (wo: MintWorkOrder | undefined) => {
    setMintData((prev) => ({
      ...prev,
      workOrderId: wo?.id ?? "",
      orderId: wo?.order.id ?? "",
      machineId: wo?.machine.id ?? "",
      yarnLotId: wo?.yarnLots[0]?.id ?? "",
    }));
  };

  const openMintDrawer = async () => {
    setIsMintOpen(true);
    setMintErrors({});
    setMintOptionsError(null);
    try {
      const res = await fetch("/api/rolls/mint-options");
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setMintOptionsError(data?.error ?? `Couldn't load work orders (HTTP ${res.status})`);
        return;
      }
      const list: MintWorkOrder[] = data.workOrders;
      setMintOptions(list);
      if (!list.some((w) => w.id === mintData.workOrderId)) pickWorkOrder(list[0]);
    } catch {
      setMintOptionsError("Couldn't load work orders. Check the connection.");
    }
  };

  const handleMintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingMint(true);
    setMintErrors({});

    try {
      const res = await fetch("/api/rolls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...mintData,
          lengthMetres: parseFloat(mintData.lengthMetres),
          weightKg: parseFloat(mintData.weightKg),
        }),
      });

      const data = await res.json().catch(() => ({ error: `Server error (HTTP ${res.status})` }));
      if (!res.ok) {
        if (data.fieldErrors) {
          setMintErrors(data.fieldErrors);
        } else {
          setMintErrors({ form: data.error || "Minting failed" });
        }
        return;
      }

      setIsMintOpen(false);
      fetchRolls();
      setSelectedRollForPrint(data);
    } catch {
      setMintErrors({ form: "Network error. Check the connection and try again." });
    } finally {
      setSubmittingMint(false);
    }
  };

  // Search/pagination now happen server-side (GET /api/rolls?search=&page=),
  // so `rolls` is already exactly this page's matching rows.
  const filteredRolls = rolls;

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Fabric Rolls & QR Registry</h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Production roll units, encrypted QR labels, and end-to-end lineage tracing.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setIsScannerOpen(true)}>
            <Scan className="w-4 h-4 mr-2" />
            Scan QR
          </Button>
          <Button variant="primary" onClick={openMintDrawer}>
            <Plus className="w-4 h-4 mr-2" />
            Mint New Roll
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <Card className="p-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by roll number, QR token, order number, or machine..."
            value={search}
            onChange={(e) => setSearchAndResetPage(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </Card>

      {/* Rolls Table */}
      <Card>
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading roll registry...
          </div>
        ) : filteredRolls.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-10 h-10 text-slate-300" />}
            title="No rolls found"
            description="Mint a new roll from production or run the seed script."
            action={
              <Button size="sm" variant="primary" onClick={openMintDrawer}>
                Mint First Roll
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll No & QR</TableHead>
                <TableHead>Order & Buyer</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead>Specs</TableHead>
                <TableHead>Yarn Lot</TableHead>
                <TableHead>QC Status</TableHead>
                <TableHead>Warehouse / Dispatch</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRolls.map((roll) => (
                <TableRow key={roll.id}>
                  <TableCell>
                    <div className="font-bold text-slate-900">{roll.rollNo}</div>
                    <span className="text-[10px] font-mono text-slate-400 truncate block max-w-[130px]">
                      {roll.qrToken}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-900">{roll.order?.orderNo}</div>
                    <div className="text-[11px] text-slate-500">
                      {roll.order?.buyer?.name || "Standard Buyer"}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-semibold text-slate-800">{roll.machine?.name}</div>
                    <div className="text-[10px] text-slate-400 uppercase">{roll.machine?.type}</div>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-slate-700">{roll.shift}</span>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium text-slate-800">{roll.lengthMetres} m</div>
                    <div className="text-[11px] text-slate-500">{roll.weightKg} kg</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium text-slate-800">{roll.yarnLot?.lotNo}</div>
                    <div className="text-[10px] text-slate-400">{roll.yarnLot?.yarnType?.name}</div>
                  </TableCell>
                  <TableCell>
                    <Badge status={roll.qcStatus} />
                  </TableCell>
                  <TableCell>
                    {roll.dispatchId ? (
                      <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Dispatched
                      </span>
                    ) : (
                      <span className="inline-flex items-center text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        In Store
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedRollForPrint(roll)}
                        title="Print QR Label"
                      >
                        <Printer className="w-4 h-4 text-slate-600" />
                      </Button>
                      <Link href={`/quality/rolls/${roll.id}`}>
                        <Button variant="ghost" size="sm" title="View Full Lineage">
                          <ExternalLink className="w-4 h-4 text-slate-500" />
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}

      {/* Mint Roll Drawer */}
      <Drawer
        isOpen={isMintOpen}
        onClose={() => setIsMintOpen(false)}
        title="Mint Production Roll"
      >
        <form onSubmit={handleMintSubmit} className="space-y-4">
          <p className="text-xs text-slate-500">
            Minting writes a new Roll record and generates an unguessable QR token for floor traceability.
          </p>

          {mintErrors.form && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {mintErrors.form}
            </div>
          )}

          {mintOptionsError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {mintOptionsError}
            </div>
          )}
          {!mintOptionsError && mintOptions.length === 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              No weaving work order is open for an order in production. Create one under Production → Work orders first.
            </div>
          )}

          <Select
            label="Weaving work order *"
            value={mintData.workOrderId}
            onChange={(e) => pickWorkOrder(mintOptions.find((w) => w.id === e.target.value))}
            error={mintErrors.workOrderId || mintErrors.orderId}
          >
            {mintOptions.map((w) => (
              <option key={w.id} value={w.id}>
                {w.order.orderNo} · {w.order.fabricType} {w.order.colour} · {w.machine.name} ({w.producedQty}/{w.plannedQty} m)
              </option>
            ))}
          </Select>

          <div className="text-xs text-slate-600">
            Loom: <span className="font-semibold text-slate-900">{selectedWorkOrder?.machine.name ?? "—"}</span>
            {mintErrors.machineId && <span className="block text-rose-600">{mintErrors.machineId}</span>}
          </div>

          <Select
            label="Shift *"
            value={mintData.shift}
            onChange={(e) => setMintData({ ...mintData, shift: e.target.value })}
          >
            <option value="Morning (Shift A)">Morning (Shift A: 06:00 - 14:00)</option>
            <option value="Evening (Shift B)">Evening (Shift B: 14:00 - 22:00)</option>
            <option value="Night (Shift C)">Night (Shift C: 22:00 - 06:00)</option>
          </Select>

          <Select
            label="Yarn Lot *"
            value={mintData.yarnLotId}
            onChange={(e) => setMintData({ ...mintData, yarnLotId: e.target.value })}
            error={mintErrors.yarnLotId}
          >
            {(selectedWorkOrder?.yarnLots ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.lotNo} ({l.yarnType})
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Length (Metres) *"
              type="number"
              step="any"
              value={mintData.lengthMetres}
              onChange={(e) => setMintData({ ...mintData, lengthMetres: e.target.value })}
              error={mintErrors.lengthMetres}
            />
            <Input
              label="Weight (Kg) *"
              type="number"
              step="any"
              value={mintData.weightKg}
              onChange={(e) => setMintData({ ...mintData, weightKg: e.target.value })}
              error={mintErrors.weightKg}
            />
          </div>

          <div className="pt-3 flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setIsMintOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              isLoading={submittingMint}
              disabled={!mintData.workOrderId || !mintData.yarnLotId}
            >
              Mint Roll & Generate QR
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Print QR Label Modal */}
      {selectedRollForPrint && <RollLabelModal roll={selectedRollForPrint} onClose={() => setSelectedRollForPrint(null)} />}

      {/* QR Scanner — mounted only once opened, so its chunk isn't fetched on page load */}
      {isScannerOpen && (
        <QrScannerModal
          isOpen={isScannerOpen}
          onClose={() => setIsScannerOpen(false)}
          onScan={(token) => {
            router.push(`/quality/rolls/search?token=${encodeURIComponent(token)}`);
          }}
        />
      )}
    </div>
  );
}

interface MintWorkOrder {
  id: string;
  status: string;
  plannedQty: number;
  producedQty: number;
  order: { id: string; orderNo: string; fabricType: string; colour: string };
  machine: { id: string; name: string; type: string };
  yarnLots: { id: string; lotNo: string; yarnType: string }[];
}
