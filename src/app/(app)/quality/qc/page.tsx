"use client";

import React, { useEffect, useState } from "react";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents } from "@/lib/realtime";
import { Button } from "@/components/quality/ui/Button";
import { Badge } from "@/components/quality/ui/Badge";
import { Card } from "@/components/quality/ui/Card";
import { Input } from "@/components/quality/ui/Input";
import { Select } from "@/components/quality/ui/Select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/quality/ui/Table";
import { EmptyState } from "@/components/quality/ui/EmptyState";
import { Drawer } from "@/components/quality/ui/Drawer";
import { QrScannerModal } from "@/components/rolls/QrScannerModal";
import { RollQrLabel } from "@/components/rolls/RollQrLabel";
import { enqueueOfflineMutation } from "@/lib/offline-queue";
import { DEFECT_TYPES } from "@/lib/validation/roll";
import {
  Scan,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Search,
  Filter,
  Printer,
  ChevronRight,
  ShieldCheck,
  CheckSquare,
} from "lucide-react";
import Link from "next/link";

export default function QcQueuePage() {
  const [rolls, setRolls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [selectedRoll, setSelectedRoll] = useState<any | null>(null);
  const [isInspectDrawerOpen, setIsInspectDrawerOpen] = useState(false);
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);

  // Inspection Form State
  const [qcResult, setQcResult] = useState<"PASS" | "REWORK" | "REJECT">("PASS");
  const [selectedDefects, setSelectedDefects] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Reload by bumping the key; the fetch itself lives inside the effect.
  const [reloadKey, setReloadKey] = useState(0);
  const fetchRolls = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/rolls");
        if (res.ok) {
          const data = await res.json();
          setRolls(data);
        }
      } catch (err) {
        console.warn("Failed to fetch rolls (might be offline):", err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reloadKey]);
  useRealtimeEvent(RealtimeEvents.RollCreated, () => {
    fetchRolls();
  });
  useRealtimeEvent(RealtimeEvents.QcCompleted, () => {
    fetchRolls();
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleScanSuccess = async (token: string) => {
    // Lookup roll by QR token
    try {
      const res = await fetch(`/api/rolls/by-qr/${encodeURIComponent(token)}`);
      if (res.ok) {
        const roll = await res.json();
        openInspectionDrawer(roll);
      } else {
        // Try searching in local list
        const localRoll = rolls.find((r) => r.qrToken === token || r.rollNo === token);
        if (localRoll) {
          openInspectionDrawer(localRoll);
        } else {
          alert(`Roll with QR token '${token}' not found.`);
        }
      }
    } catch {
      // Offline lookup
      const localRoll = rolls.find((r) => r.qrToken === token || r.rollNo === token);
      if (localRoll) {
        openInspectionDrawer(localRoll);
      } else {
        alert(`Roll with QR token '${token}' not found in offline cache.`);
      }
    }
  };

  const openInspectionDrawer = (roll: any) => {
    setSelectedRoll(roll);
    setQcResult(roll.qcStatus === "PENDING" ? "PASS" : roll.qcStatus);
    setSelectedDefects([]);
    setNotes("");
    setFormErrors({});
    setIsInspectDrawerOpen(true);
  };

  const toggleDefect = (defectId: string) => {
    setSelectedDefects((prev) =>
      prev.includes(defectId) ? prev.filter((d) => d !== defectId) : [...prev, defectId]
    );
  };

  const handleInspectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRoll) return;

    // Client-side pre-validation
    const errors: Record<string, string> = {};
    if ((qcResult === "REWORK" || qcResult === "REJECT") && selectedDefects.length === 0) {
      errors.defects = "At least one defect must be selected for REWORK or REJECT";
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setSubmitting(true);
    setFormErrors({});

    const payload = {
      result: qcResult,
      defects: selectedDefects,
      notes: notes.trim() || null,
    };

    try {
      if (!navigator.onLine) {
        // OFFLINE: Save to IndexedDB offline queue
        await enqueueOfflineMutation(
          "qc_entry",
          `/api/rolls/${selectedRoll.id}/qc`,
          "POST",
          payload
        );

        // Optimistically update local roll state
        setRolls((prev) =>
          prev.map((r) =>
            r.id === selectedRoll.id
              ? {
                  ...r,
                  qcStatus: qcResult,
                  qcRecords: [
                    {
                      id: `temp-${Date.now()}`,
                      result: qcResult,
                      defects: JSON.stringify(selectedDefects),
                      notes,
                      inspectedAt: new Date().toISOString(),
                    },
                    ...(r.qcRecords || []),
                  ],
                }
              : r
          )
        );

        showToast(`Saved offline! QC record for ${selectedRoll.rollNo} queued for sync.`);
        setIsInspectDrawerOpen(false);
        return;
      }

      // ONLINE: Send to server
      const res = await fetch(`/api/rolls/${selectedRoll.id}/qc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const resData = await res.json();
      if (!res.ok) {
        if (resData.fieldErrors) {
          setFormErrors(resData.fieldErrors);
        } else {
          setFormErrors({ form: resData.error || "Submission failed" });
        }
        return;
      }

      // Success
      showToast(`QC completed: ${selectedRoll.rollNo} marked as ${qcResult}`);
      setIsInspectDrawerOpen(false);
      fetchRolls();
    } catch (err: any) {
      // Network drop during call -> fallback to offline queue
      await enqueueOfflineMutation(
        "qc_entry",
        `/api/rolls/${selectedRoll.id}/qc`,
        "POST",
        payload
      );
      setRolls((prev) =>
        prev.map((r) => (r.id === selectedRoll.id ? { ...r, qcStatus: qcResult } : r))
      );
      showToast(`Network drop: QC record for ${selectedRoll.rollNo} queued offline.`);
      setIsInspectDrawerOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRolls = rolls.filter((roll) => {
    if (statusFilter !== "ALL" && roll.qcStatus !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchRoll = roll.rollNo.toLowerCase().includes(q);
      const matchOrder = roll.order?.orderNo?.toLowerCase().includes(q);
      const matchMachine = roll.machine?.name?.toLowerCase().includes(q);
      const matchLot = roll.yarnLot?.lotNo?.toLowerCase().includes(q);
      return matchRoll || matchOrder || matchMachine || matchLot;
    }
    return true;
  });

  const pendingCount = rolls.filter((r) => r.qcStatus === "PENDING").length;
  const passCount = rolls.filter((r) => r.qcStatus === "PASS").length;
  const reworkCount = rolls.filter((r) => r.qcStatus === "REWORK").length;
  const rejectCount = rolls.filter((r) => r.qcStatus === "REJECT").length;

  return (
    <div className="space-y-6">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2 border border-slate-700 animate-slide-up">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header & Quick Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Quality Inspection Queue</h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Inspect finished rolls, log defect root causes, and verify QR tokens. Works offline.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => setScannerOpen(true)}
            className="shadow-sm font-semibold"
          >
            <Scan className="w-4 h-4 mr-2" />
            Scan Roll QR
          </Button>
        </div>
      </div>

      {/* Metrics Counter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setStatusFilter("PENDING")}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === "PENDING"
              ? "bg-slate-900 text-white border-slate-900 shadow-md"
              : "bg-white text-slate-800 border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider opacity-70">Pending QC</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-2xl font-black mt-1">{pendingCount}</p>
        </button>

        <button
          onClick={() => setStatusFilter("PASS")}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === "PASS"
              ? "bg-emerald-700 text-white border-emerald-700 shadow-md"
              : "bg-white text-slate-800 border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider opacity-70">Passed</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-black mt-1">{passCount}</p>
        </button>

        <button
          onClick={() => setStatusFilter("REWORK")}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === "REWORK"
              ? "bg-amber-600 text-white border-amber-600 shadow-md"
              : "bg-white text-slate-800 border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider opacity-70">Rework</span>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black mt-1">{reworkCount}</p>
        </button>

        <button
          onClick={() => setStatusFilter("REJECT")}
          className={`p-4 rounded-xl border text-left transition-all ${
            statusFilter === "REJECT"
              ? "bg-rose-700 text-white border-rose-700 shadow-md"
              : "bg-white text-slate-800 border-slate-200/80 hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider opacity-70">Rejected</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-black mt-1">{rejectCount}</p>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <Card className="p-3">
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by Roll No, Order No, Machine, Yarn Lot..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs py-2 w-full sm:w-36"
            >
              <option value="ALL">All Statuses</option>
              <option value="PENDING">Pending</option>
              <option value="PASS">Pass</option>
              <option value="REWORK">Rework</option>
              <option value="REJECT">Reject</option>
            </Select>

            {statusFilter !== "ALL" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusFilter("ALL")}
                className="text-xs text-slate-500"
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Rolls Queue Table */}
      <Card>
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            Loading inspection queue...
          </div>
        ) : filteredRolls.length === 0 ? (
          <EmptyState
            icon={<CheckSquare className="w-10 h-10 text-slate-300" />}
            title="No rolls found"
            description="No fabric rolls match your selected filter or search query."
            action={
              <Button size="sm" variant="outline" onClick={() => setStatusFilter("ALL")}>
                View All Rolls
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll No</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Machine / Shift</TableHead>
                <TableHead>Dimensions</TableHead>
                <TableHead>Yarn Lot</TableHead>
                <TableHead>QC Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRolls.map((roll) => (
                <TableRow key={roll.id}>
                  <TableCell>
                    <div className="font-bold text-slate-900">{roll.rollNo}</div>
                    <span className="text-[10px] font-mono text-slate-400 truncate block max-w-[120px]">
                      {roll.qrToken}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-900">{roll.order?.orderNo}</div>
                    <div className="text-xs text-slate-500">
                      {roll.order?.fabricType} • {roll.order?.colour}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-semibold text-slate-800">{roll.machine?.name}</div>
                    <div className="text-[11px] text-slate-500">{roll.shift}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs text-slate-800 font-medium">{roll.lengthMetres} m</div>
                    <div className="text-[11px] text-slate-500">{roll.weightKg} kg</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-medium text-slate-800">
                      {roll.yarnLot?.lotNo}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {roll.yarnLot?.yarnType?.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge status={roll.qcStatus} />
                    {roll.dispatchId && (
                      <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">
                        Dispatched
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!!roll.dispatchId}
                        onClick={() => openInspectionDrawer(roll)}
                        className="text-xs"
                      >
                        {roll.qcStatus === "PENDING" ? "Inspect" : "Re-Inspect"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedRoll(roll);
                          setIsLabelModalOpen(true);
                        }}
                        title="Print QR Label"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-600" />
                      </Button>
                      <Link href={`/quality/rolls/${roll.id}`}>
                        <Button variant="ghost" size="sm" title="View Roll Trace">
                          <ChevronRight className="w-4 h-4 text-slate-400" />
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

      {/* QC Inspection Drawer */}
      <Drawer
        isOpen={isInspectDrawerOpen}
        onClose={() => setIsInspectDrawerOpen(false)}
        title={selectedRoll ? `Inspect Roll: ${selectedRoll.rollNo}` : "QC Inspection"}
      >
        {selectedRoll && (
          <form onSubmit={handleInspectSubmit} className="space-y-5">
            {/* Roll Overview Banner */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Order:</span>
                <span className="font-bold text-slate-900">{selectedRoll.order?.orderNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Machine / Shift:</span>
                <span className="font-semibold text-slate-800">
                  {selectedRoll.machine?.name} ({selectedRoll.shift})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Length & Weight:</span>
                <span className="font-semibold text-slate-800">
                  {selectedRoll.lengthMetres} m • {selectedRoll.weightKg} kg
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Yarn Lot:</span>
                <span className="font-semibold text-slate-800">
                  {selectedRoll.yarnLot?.lotNo} ({selectedRoll.yarnLot?.yarnType?.name})
                </span>
              </div>
            </div>

            {/* General Form Error */}
            {formErrors.form && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                {formErrors.form}
              </div>
            )}

            {/* QC Result Selection (Token Colors) */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Inspection Result *
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setQcResult("PASS");
                    setSelectedDefects([]);
                  }}
                  className={`py-3 px-2 rounded-xl border font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all ${
                    qcResult === "PASS"
                      ? "bg-emerald-600 text-white border-emerald-600 shadow-md ring-2 ring-emerald-500/20"
                      : "bg-emerald-50/50 text-emerald-800 border-emerald-200 hover:bg-emerald-100/50"
                  }`}
                >
                  <CheckCircle2 className="w-5 h-5" />
                  PASS
                </button>

                <button
                  type="button"
                  onClick={() => setQcResult("REWORK")}
                  className={`py-3 px-2 rounded-xl border font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all ${
                    qcResult === "REWORK"
                      ? "bg-amber-600 text-white border-amber-600 shadow-md ring-2 ring-amber-500/20"
                      : "bg-amber-50/50 text-amber-800 border-amber-200 hover:bg-amber-100/50"
                  }`}
                >
                  <AlertTriangle className="w-5 h-5" />
                  REWORK
                </button>

                <button
                  type="button"
                  onClick={() => setQcResult("REJECT")}
                  className={`py-3 px-2 rounded-xl border font-bold text-xs flex flex-col items-center justify-center gap-1.5 transition-all ${
                    qcResult === "REJECT"
                      ? "bg-rose-600 text-white border-rose-600 shadow-md ring-2 ring-rose-500/20"
                      : "bg-rose-50/50 text-rose-800 border-rose-200 hover:bg-rose-100/50"
                  }`}
                >
                  <XCircle className="w-5 h-5" />
                  REJECT
                </button>
              </div>
            </div>

            {/* Defect Types Selection (Mandatory for REWORK or REJECT) */}
            {(qcResult === "REWORK" || qcResult === "REJECT") && (
              <div className="space-y-2 p-3 bg-rose-50/50 rounded-xl border border-rose-200">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-rose-900 uppercase tracking-wider">
                    Defect Classification *
                  </label>
                  <span className="text-[10px] text-rose-600 font-semibold">
                    (Select at least one)
                  </span>
                </div>
                <div className="space-y-1.5">
                  {DEFECT_TYPES.map((defect) => (
                    <label
                      key={defect.id}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        selectedDefects.includes(defect.id)
                          ? "bg-rose-100/80 border-rose-300 font-bold text-rose-950"
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedDefects.includes(defect.id)}
                        onChange={() => toggleDefect(defect.id)}
                        className="rounded border-slate-300 text-rose-600 focus:ring-rose-500 w-4 h-4"
                      />
                      <span>{defect.label}</span>
                    </label>
                  ))}
                </div>
                {formErrors.defects && (
                  <p className="text-xs text-rose-600 font-semibold">{formErrors.defects}</p>
                )}
              </div>
            )}

            <p className="text-xs text-slate-500">Recorded under your signed-in account as the inspector.</p>

            {/* Notes */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                Inspection Notes / Observations
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Specific roll location, severity, or corrective recommendations..."
                className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Buttons */}
            <div className="pt-2 flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setIsInspectDrawerOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="flex-1"
                isLoading={submitting}
              >
                Save Inspection
              </Button>
            </div>
          </form>
        )}
      </Drawer>

      {/* QR Label Print Modal */}
      {isLabelModalOpen && selectedRoll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-base">Print Roll Label</h3>
              <button
                onClick={() => setIsLabelModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>
            <RollQrLabel roll={selectedRoll} />
          </div>
        </div>
      )}

      {/* Camera QR Scanner Modal */}
      <QrScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScanSuccess}
      />
    </div>
  );
}
