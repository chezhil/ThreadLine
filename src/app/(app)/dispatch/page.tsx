"use client";

import React, { useEffect, useState } from "react";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import { Button } from "@/components/quality/ui/Button";
import { Badge } from "@/components/quality/ui/Badge";
import { Card } from "@/components/quality/ui/Card";
import { Input } from "@/components/quality/ui/Input";
import { Select } from "@/components/quality/ui/Select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/quality/ui/Table";
import { EmptyState } from "@/components/quality/ui/EmptyState";
import { QrScannerModal } from "@/components/rolls/QrScannerModal";
import { enqueueOfflineMutation, newMutationId } from "@/lib/offline-queue";
import { GST_RATE } from "@/lib/billing";
import {
  Truck,
  Scan,
  CheckCircle2,
  AlertCircle,
  FileText,
  Clock,
  Layers,
  ShieldCheck,
  PackageCheck,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

export default function DispatchPage() {
  const [buyers, setBuyers] = useState<any[]>([]);
  const [selectedBuyerId, setSelectedBuyerId] = useState<string>("");
  const [truckNo, setTruckNo] = useState("TN-38-AX-9942");
  const [availableRolls, setAvailableRolls] = useState<any[]>([]);
  const [selectedRollIds, setSelectedRollIds] = useState<string[]>([]);
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"new" | "history">("new");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [editingDispatchId, setEditingDispatchId] = useState<string | null>(null);
  const [editTruckNo, setEditTruckNo] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Reload by bumping the key; the fetch itself lives inside the effect.
  const [reloadKey, setReloadKey] = useState(0);
  const loadData = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    const load = async () => {
      try {
        // 1. Fetch undispatched rolls with PASS status
        const rollsRes = await fetch("/api/rolls?qcStatus=PASS&dispatched=false");
        if (rollsRes.ok) {
          const rollsData = await rollsRes.json();
          setAvailableRolls(rollsData);

          // Derive unique buyers from available rolls
          const buyerMap = new Map();
          rollsData.forEach((r: any) => {
            if (r.order?.buyer) {
              buyerMap.set(r.order.buyer.id, r.order.buyer);
            }
          });
          const buyersList = Array.from(buyerMap.values());
          setBuyers(buyersList);
          if (buyersList.length > 0 && !selectedBuyerId) {
            setSelectedBuyerId(buyersList[0].id);
          }
        }

        // 2. Fetch past dispatches
        const dispatchesRes = await fetch("/api/dispatches");
        if (dispatchesRes.ok) {
          const dispData = await dispatchesRes.json();
          setDispatches(dispData);
        }
      } catch (err) {
        console.warn("Offline or load error:", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reloadKey]);
  useRealtimeEvent(RealtimeEvents.QcCompleted, () => {
    loadData();
  });
  useRealtimeEvent(RealtimeEvents.DispatchCompleted, () => {
    loadData();
  });
  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if (change.entity === "Dispatch") loadData();
  });

  async function saveTruckNo(dispatchId: string) {
    setEditError(null);
    if (!editTruckNo.trim()) {
      setEditError("Enter a truck number");
      return;
    }
    setEditBusy(true);
    const res = await fetch(`/api/dispatches/${dispatchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ truckNo: editTruckNo.trim() }),
    });
    const body = await res.json().catch(() => ({}));
    setEditBusy(false);
    if (!res.ok) {
      const msg = typeof body?.fieldErrors === "object" ? Object.values(body.fieldErrors)[0] : body?.error;
      setEditError((Array.isArray(msg) ? msg[0] : msg) ?? "Couldn't save the truck number");
      return;
    }
    setEditingDispatchId(null);
    loadData();
  }

  const eligibleRollsForBuyer = availableRolls.filter(
    (r) => r.order?.buyerId === selectedBuyerId
  );

  const toggleRoll = (rollId: string) => {
    setSelectedRollIds((prev) =>
      prev.includes(rollId) ? prev.filter((id) => id !== rollId) : [...prev, rollId]
    );
  };

  const selectAllEligible = () => {
    if (selectedRollIds.length === eligibleRollsForBuyer.length) {
      setSelectedRollIds([]);
    } else {
      setSelectedRollIds(eligibleRollsForBuyer.map((r) => r.id));
    }
  };

  // QR Scanning Roll onto Truck
  const handleScanRollOntoTruck = async (token: string) => {
    try {
      const res = await fetch(`/api/rolls/by-qr/${encodeURIComponent(token)}`);
      let roll: any = null;
      if (res.ok) {
        roll = await res.json();
      } else {
        roll = availableRolls.find((r) => r.qrToken === token || r.rollNo === token);
      }

      if (!roll) {
        alert(`Roll with QR token '${token}' not found.`);
        return;
      }

      if (roll.dispatchId) {
        alert(`Roll ${roll.rollNo} has ALREADY been dispatched on another truck! Double dispatch prevented.`);
        return;
      }

      if (roll.qcStatus !== "PASS") {
        alert(`Roll ${roll.rollNo} QC status is '${roll.qcStatus}'. Only PASS rolls can be dispatched.`);
        return;
      }

      if (selectedBuyerId && roll.order?.buyerId !== selectedBuyerId) {
        const proceed = confirm(
          `Roll ${roll.rollNo} belongs to buyer '${roll.order?.buyer?.name || "Other"}', but truck is set for '${buyers.find((b) => b.id === selectedBuyerId)?.name}'. Switch buyer to load this roll?`
        );
        if (proceed) {
          setSelectedBuyerId(roll.order.buyerId);
          setSelectedRollIds([roll.id]);
          showToast(`Switched buyer and scanned ${roll.rollNo} onto truck`);
        }
        return;
      }

      if (selectedRollIds.includes(roll.id)) {
        showToast(`Roll ${roll.rollNo} is already selected on this truck.`);
        return;
      }

      setSelectedRollIds((prev) => [...prev, roll.id]);
      showToast(`Scanned ${roll.rollNo} onto truck!`);
    } catch {
      alert("Error scanning roll.");
    }
  };

  const handleDispatchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedBuyerId) {
      setFormErrors({ buyerId: "Please select a buyer" });
      return;
    }
    if (!truckNo.trim()) {
      setFormErrors({ truckNo: "Please enter a truck number" });
      return;
    }
    if (selectedRollIds.length === 0) {
      setFormErrors({ rollIds: "Please select at least one roll to dispatch" });
      return;
    }

    setSubmitting(true);
    setFormErrors({});

    // Same id for the online attempt and the offline fallback (see QC page).
    const clientMutationId = newMutationId();
    const payload = {
      buyerId: selectedBuyerId,
      truckNo: truckNo.trim(),
      rollIds: selectedRollIds,
    };

    try {
      if (!navigator.onLine) {
        // OFFLINE: Queue dispatch mutation in IndexedDB
        await enqueueOfflineMutation("dispatch", "/api/dispatches", "POST", payload, { id: clientMutationId });

        // Optimistically remove dispatched rolls from local stock
        setAvailableRolls((prev) =>
          prev.filter((r) => !selectedRollIds.includes(r.id))
        );
        setSelectedRollIds([]);
        showToast(`Saved offline! Truck ${truckNo} dispatch queued for sync.`);
        setActiveTab("history");
        return;
      }

      const res = await fetch("/api/dispatches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, clientMutationId }),
      });

      const data = await res.json().catch(() => ({ error: `Server error (HTTP ${res.status})` }));
      if (!res.ok) {
        if (data.fieldErrors) {
          setFormErrors(data.fieldErrors);
        } else {
          setFormErrors({ form: data.error || "Dispatch failed" });
        }
        return;
      }

      showToast(`Success! Truck ${truckNo} dispatched with ${selectedRollIds.length} rolls.`);
      setSelectedRollIds([]);
      loadData();
      setActiveTab("history");
    } catch {
      // Network drop -> fallback offline
      await enqueueOfflineMutation("dispatch", "/api/dispatches", "POST", payload, { id: clientMutationId });
      setAvailableRolls((prev) =>
        prev.filter((r) => !selectedRollIds.includes(r.id))
      );
      setSelectedRollIds([]);
      showToast(`Network drop: Truck ${truckNo} dispatch queued offline.`);
      setActiveTab("history");
    } finally {
      setSubmitting(false);
    }
  };

  // Calculations for current selection
  const selectedRolls = availableRolls.filter((r) => selectedRollIds.includes(r.id));
  const totalMetres = selectedRolls.reduce((acc, r) => acc + r.lengthMetres, 0);
  const totalWeight = selectedRolls.reduce((acc, r) => acc + r.weightKg, 0);
  // Shipment value at each roll's own order price (a truck can carry rolls of
  // several orders for the same buyer).
  const subtotal = selectedRolls.reduce((acc, r) => acc + r.lengthMetres * (r.order?.pricePerMetre ?? 0), 0);
  const gst = subtotal * GST_RATE; // Module 1's GST rate, same as the real invoice
  const invoiceTotal = subtotal + gst;
  const ordersOnTruck = Array.from(new Map(selectedRolls.map((r) => [r.orderId, r.order])).values());
  const toInvoice = ordersOnTruck.filter((o) => o && !(o.invoices?.length));

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Dispatch & Truck Loading
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Load inspected PASS rolls onto trucks, issue GST invoices, and prevent double dispatch.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => setScannerOpen(true)}>
            <Scan className="w-4 h-4 mr-2" />
            Scan Rolls onto Truck
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab("new")}
          className={`py-2 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === "new"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          New Truck Dispatch
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`py-2 px-4 text-xs font-bold border-b-2 transition-colors ${
            activeTab === "history"
              ? "border-indigo-600 text-indigo-600"
              : "border-transparent text-slate-500 hover:text-slate-900"
          }`}
        >
          Dispatch History ({dispatches.length})
        </button>
      </div>

      {activeTab === "new" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Form & Roll Selector */}
          <div className="lg:col-span-2 space-y-5">
            {/* Truck & Buyer Configuration */}
            <Card title="Truck & Destination" subtitle="Select recipient and vehicle">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Buyer *"
                  value={selectedBuyerId}
                  onChange={(e) => {
                    setSelectedBuyerId(e.target.value);
                    setSelectedRollIds([]);
                  }}
                  error={formErrors.buyerId}
                >
                  {buyers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>

                <Input
                  label="Truck Vehicle Number *"
                  placeholder="e.g. TN-38-AX-9942"
                  value={truckNo}
                  onChange={(e) => setTruckNo(e.target.value)}
                  error={formErrors.truckNo}
                />
              </div>
            </Card>

            {/* Eligible Rolls in Warehouse Table */}
            <Card
              title="Eligible Warehouse Rolls (QC Passed)"
              subtitle={`${eligibleRollsForBuyer.length} rolls in store for selected buyer`}
              actions={
                eligibleRollsForBuyer.length > 0 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={selectAllEligible}
                    className="text-xs"
                  >
                    {selectedRollIds.length === eligibleRollsForBuyer.length
                      ? "Deselect All"
                      : "Select All"}
                  </Button>
                ) : null
              }
            >
              {eligibleRollsForBuyer.length === 0 ? (
                <EmptyState
                  icon={<Layers className="w-8 h-8 text-slate-300" />}
                  title="No PASS rolls for this buyer"
                  description="All rolls are either dispatched, pending inspection, or belonging to another buyer."
                  action={
                    <Link href="/quality/qc">
                      <Button size="sm" variant="outline">
                        Go to QC Queue
                      </Button>
                    </Link>
                  }
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">Select</TableHead>
                      <TableHead>Roll No & QR</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Length</TableHead>
                      <TableHead>Weight</TableHead>
                      <TableHead>Machine</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {eligibleRollsForBuyer.map((roll) => {
                      const isSelected = selectedRollIds.includes(roll.id);
                      return (
                        <TableRow
                          key={roll.id}
                          className={isSelected ? "bg-indigo-50/50" : ""}
                          onClick={() => toggleRoll(roll.id)}
                        >
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRoll(roll.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                            />
                          </TableCell>
                          <TableCell>
                            <div className="font-bold text-slate-900">{roll.rollNo}</div>
                            <span className="text-[10px] font-mono text-slate-400 truncate block max-w-[120px]">
                              {roll.qrToken}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-900">{roll.order?.orderNo}</div>
                            <div className="text-[11px] text-slate-500">
                              {roll.order?.fabricType}
                            </div>
                          </TableCell>
                          <TableCell className="font-semibold text-slate-800">
                            {roll.lengthMetres} m
                          </TableCell>
                          <TableCell className="font-medium text-slate-700">
                            {roll.weightKg} kg
                          </TableCell>
                          <TableCell className="text-xs text-slate-600">
                            {roll.machine?.name}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>

          {/* Right Column: Dispatch Manifest & Invoice Summary */}
          <div className="space-y-5">
            <Card title="Dispatch Manifest" subtitle="Loading manifest summary">
              <div className="space-y-4">
                {formErrors.rollIds && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                    {formErrors.rollIds}
                  </div>
                )}
                {formErrors.form && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                    {formErrors.form}
                  </div>
                )}

                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Selected Rolls:</span>
                    <span className="font-bold text-slate-900 text-sm">
                      {selectedRollIds.length} rolls
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Metres:</span>
                    <span className="font-bold text-slate-900">
                      {totalMetres.toLocaleString()} m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Weight:</span>
                    <span className="font-bold text-slate-900">
                      {totalWeight.toLocaleString()} kg
                    </span>
                  </div>
                </div>

                {/* GST Invoice Preview Card */}
                <div className="bg-indigo-50/60 p-4 rounded-xl border border-indigo-200/80 space-y-2 text-xs">
                  <div className="flex items-center gap-1.5 text-indigo-900 font-bold uppercase text-[11px] tracking-wider">
                    <FileText className="w-4 h-4 text-indigo-600" />
                    GST Invoice Preview
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-slate-600">Subtotal:</span>
                    <span className="font-semibold text-slate-900">
                      ₹{subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">GST ({GST_RATE * 100}%):</span>
                    <span className="font-semibold text-slate-900">
                      ₹{gst.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-indigo-200 font-bold text-slate-950 text-sm">
                    <span>Value incl. GST:</span>
                    <span className="text-indigo-700">
                      ₹{invoiceTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Each order&apos;s GST invoice covers its full quantity and is raised once, with its first truck.
                    {toInvoice.length > 0
                      ? ` This truck raises it for ${toInvoice.map((o) => o.orderNo).join(", ")}.`
                      : ordersOnTruck.length > 0
                        ? " Every order on this truck is already invoiced."
                        : ""}
                  </p>
                </div>

                <Button
                  className="w-full shadow-md font-bold"
                  variant="primary"
                  size="lg"
                  disabled={selectedRollIds.length === 0 || submitting}
                  isLoading={submitting}
                  onClick={handleDispatchSubmit}
                >
                  <Truck className="w-5 h-5 mr-2" />
                  Dispatch Truck ({selectedRollIds.length})
                </Button>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        /* Dispatch History Table */
        <Card title="Past Dispatches" subtitle="Completed truck departures and invoices">
          {dispatches.length === 0 ? (
            <EmptyState
              icon={<Truck className="w-8 h-8 text-slate-300" />}
              title="No past dispatches"
              description="No trucks have been dispatched yet."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Truck No</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Departure Date</TableHead>
                  <TableHead>Rolls Loaded</TableHead>
                  <TableHead>Total Metres</TableHead>
                  <TableHead>Invoice ID</TableHead>
                  <TableHead>{""}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dispatches.map((disp) => {
                  const dispMetres = disp.rolls?.reduce(
                    (acc: number, r: any) => acc + (r.lengthMetres || 0),
                    0
                  );
                  const isEditing = editingDispatchId === disp.id;
                  return (
                    <TableRow key={disp.id}>
                      <TableCell className="font-bold text-slate-900">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <Input
                              value={editTruckNo}
                              onChange={(e) => setEditTruckNo(e.target.value)}
                              className="w-32"
                              onClick={(e) => e.stopPropagation()}
                            />
                            {editError && <span className="text-[11px] text-rose-600 font-medium">{editError}</span>}
                          </div>
                        ) : (
                          disp.truckNo
                        )}
                      </TableCell>
                      <TableCell className="font-medium text-slate-800">
                        {disp.rolls?.[0]?.order?.buyer?.name || "Direct Buyer"}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {new Date(disp.dispatchedAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-semibold text-slate-900">
                        {disp.rolls?.length || 0} rolls
                      </TableCell>
                      <TableCell className="font-semibold text-indigo-700">
                        {dispMetres ? `${dispMetres} m` : "N/A"}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {disp.invoiceId || "Issued"}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="primary" isLoading={editBusy} onClick={() => saveTruckNo(disp.id)}>
                              Save
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingDispatchId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingDispatchId(disp.id);
                              setEditTruckNo(disp.truckNo);
                              setEditError(null);
                            }}
                          >
                            Edit truck no.
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* QR Scanner */}
      <QrScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScanRollOntoTruck}
        title="Scan Roll onto Truck"
      />
    </div>
  );
}
