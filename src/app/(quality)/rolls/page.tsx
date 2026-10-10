"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { Drawer } from "@/components/ui/Drawer";
import { RollQrLabel } from "@/components/rolls/RollQrLabel";
import { QrScannerModal } from "@/components/rolls/QrScannerModal";
import {
  Layers,
  Plus,
  Printer,
  Scan,
  Search,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";

export default function RollsListPage() {
  const [rolls, setRolls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isMintOpen, setIsMintOpen] = useState(false);
  const [selectedRollForPrint, setSelectedRollForPrint] = useState<any | null>(null);
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

  // Dropdown lists
  const [orders, setOrders] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [yarnLots, setYarnLots] = useState<any[]>([]);

  const fetchRolls = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/rolls");
      if (res.ok) {
        const data = await res.json();
        setRolls(data);
      }
    } catch (err) {
      console.warn("Failed to fetch rolls:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRolls();
  }, []);

  const openMintDrawer = async () => {
    setIsMintOpen(true);
    setMintErrors({});
    // Extract unique orders, machines, and yarnLots from existing rolls or default
    try {
      const ordersMap = new Map();
      const machinesMap = new Map();
      const yarnLotsMap = new Map();

      rolls.forEach((r) => {
        if (r.order) ordersMap.set(r.order.id, r.order);
        if (r.machine) machinesMap.set(r.machine.id, r.machine);
        if (r.yarnLot) yarnLotsMap.set(r.yarnLot.id, r.yarnLot);
      });

      setOrders(Array.from(ordersMap.values()));
      setMachines(Array.from(machinesMap.values()));
      setYarnLots(Array.from(yarnLotsMap.values()));

      if (ordersMap.size > 0 && !mintData.orderId) {
        const firstOrder = Array.from(ordersMap.values())[0];
        setMintData((prev) => ({
          ...prev,
          orderId: firstOrder.id,
          workOrderId: firstOrder.id, // fallback
        }));
      }
      if (machinesMap.size > 0 && !mintData.machineId) {
        setMintData((prev) => ({ ...prev, machineId: Array.from(machinesMap.values())[0].id }));
      }
      if (yarnLotsMap.size > 0 && !mintData.yarnLotId) {
        setMintData((prev) => ({ ...prev, yarnLotId: Array.from(yarnLotsMap.values())[0].id }));
      }
    } catch (err) {
      console.error(err);
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

      const data = await res.json();
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
    } catch (err: any) {
      setMintErrors({ form: err.message || "Network error" });
    } finally {
      setSubmittingMint(false);
    }
  };

  const filteredRolls = rolls.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.rollNo.toLowerCase().includes(q) ||
      r.order?.orderNo?.toLowerCase().includes(q) ||
      r.machine?.name?.toLowerCase().includes(q) ||
      r.qrToken?.toLowerCase().includes(q)
    );
  });

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
            onChange={(e) => setSearch(e.target.value)}
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
                      <Link href={`/rolls/${roll.id}`}>
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

          <Select
            label="Associated Order *"
            value={mintData.orderId}
            onChange={(e) => {
              setMintData({
                ...mintData,
                orderId: e.target.value,
                workOrderId: e.target.value, // link
              });
            }}
            error={mintErrors.orderId}
          >
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.orderNo} ({o.fabricType} - {o.colour})
              </option>
            ))}
          </Select>

          <Select
            label="Machine *"
            value={mintData.machineId}
            onChange={(e) => setMintData({ ...mintData, machineId: e.target.value })}
            error={mintErrors.machineId}
          >
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.type.toUpperCase()})
              </option>
            ))}
          </Select>

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
            {yarnLots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.lotNo} ({l.yarnType?.name || "Yarn"})
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
            >
              Mint Roll & Generate QR
            </Button>
          </div>
        </form>
      </Drawer>

      {/* Print QR Label Modal */}
      {selectedRollForPrint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-base">Print QR Label</h3>
              <button
                onClick={() => setSelectedRollForPrint(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>
            <RollQrLabel roll={selectedRollForPrint} />
          </div>
        </div>
      )}

      {/* QR Scanner */}
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={(token) => {
          window.location.href = `/rolls/search?token=${encodeURIComponent(token)}`;
        }}
      />
    </div>
  );
}
