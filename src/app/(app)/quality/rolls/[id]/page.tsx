"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/quality/ui/Button";
import { Badge } from "@/components/quality/ui/Badge";
import { Card } from "@/components/quality/ui/Card";
import { Drawer } from "@/components/quality/ui/Drawer";
import { Input } from "@/components/quality/ui/Input";
import { Select } from "@/components/quality/ui/Select";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { RealtimeEvents, type DataChange } from "@/lib/realtime";
import {
  ArrowLeft,
  Printer,
  CheckSquare,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { QcRecord, RollRow } from "@/lib/quality/types";

// The label pulls in the qrcode encoder; it's only shown in the print modal.
const RollLabelModal = dynamic(() => import("@/components/rolls/RollLabelModal").then((m) => m.RollLabelModal), { ssr: false });

export default function RollDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rollId = params.id as string;
  const qrTokenFromQuery = searchParams.get("token");

  const [roll, setRoll] = useState<RollRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  // Reload by bumping the key; the fetch itself lives inside the effect
  // (same pattern as the Dispatch page).
  const [reloadKey, setReloadKey] = useState(0);
  const refetch = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    async function fetchRoll() {
      setLoading(true);
      setError(null);
      try {
        let endpoint = `/api/rolls/${rollId}`;
        // If accessed by token search
        if (rollId === "search" && qrTokenFromQuery) {
          endpoint = `/api/rolls/by-qr/${encodeURIComponent(qrTokenFromQuery)}`;
        }

        const res = await fetch(endpoint);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Roll not found");
        }
        const data = await res.json();
        setRoll(data);
      } catch (err) {
        setError((err instanceof Error && err.message) || "Failed to load roll details");
      } finally {
        setLoading(false);
      }
    }

    if (rollId) fetchRoll();
  }, [rollId, qrTokenFromQuery, reloadKey]);

  useRealtimeEvent<DataChange>(RealtimeEvents.DataChanged, (change) => {
    if ((change.entity === "Roll" && change.id === roll?.id) || (change.entity === "QCRecord" && roll?.id)) refetch();
  });

  async function deleteRoll() {
    setActionError(null);
    setActionBusy(true);
    if (!roll) return;
    const res = await fetch(`/api/rolls/${roll.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    setActionBusy(false);
    setConfirmDelete(false);
    if (!res.ok) {
      setActionError(body?.error ?? "Couldn't delete the roll");
      return;
    }
    router.push("/quality/rolls");
  }

  if (loading) {
    return (
      <div className="p-16 text-center text-slate-500">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium">Resolving roll lineage & QR token...</p>
      </div>
    );
  }

  if (error || !roll) {
    return (
      <div className="max-w-md mx-auto my-12 p-6 bg-white rounded-2xl border border-rose-200 text-center space-y-4 shadow-sm">
        <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
        <div>
          <h2 className="text-lg font-bold text-slate-900">Roll Not Found</h2>
          <p className="text-xs text-slate-500 mt-1">{error || "Unable to locate roll data."}</p>
        </div>
        <Link href="/quality/rolls">
          <Button variant="outline" size="sm">
            Back to Rolls Registry
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link href="/quality/rolls">
          <Button variant="ghost" size="sm" className="text-slate-600">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Rolls
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPrintModal(true)}
          >
            <Printer className="w-4 h-4 mr-1.5" />
            Print QR Label
          </Button>
          {!roll.dispatchId && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                Edit roll
              </Button>
              {(!roll.qcRecords || roll.qcRecords.length === 0) && (
                confirmDelete ? (
                  <>
                    <Button variant="danger" size="sm" isLoading={actionBusy} onClick={deleteRoll}>
                      Confirm delete
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                    Delete roll
                  </Button>
                )
              )}
              <Link href="/quality/qc">
                <Button variant="primary" size="sm">
                  <CheckSquare className="w-4 h-4 mr-1.5" />
                  Inspect in QC Queue
                </Button>
              </Link>
            </>
          )}
        </div>
      </div>
      {actionError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-800">{actionError}</div>
      )}

      {/* Hero Header Card */}
      <Card className="p-6 bg-gradient-to-r from-slate-900 to-indigo-950 text-white border-0 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-black tracking-tight">{roll.rollNo}</h1>
              <Badge status={roll.qcStatus} />
              {roll.dispatchId ? (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
                  Dispatched
                </span>
              ) : (
                <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  In Warehouse Stock
                </span>
              )}
            </div>
            <p className="text-xs font-mono text-indigo-200">
              QR Token: {roll.qrToken}
            </p>
          </div>

          <div className="flex sm:flex-col items-end gap-2 text-right">
            <div>
              <span className="text-[10px] text-indigo-300 uppercase block font-semibold">Dimensions</span>
              <span className="text-xl font-bold">{roll.lengthMetres} m</span>
              <span className="text-xs text-indigo-300 ml-1.5 font-normal">({roll.weightKg} kg)</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Grid of Lineage Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Order & Buyer Lineage */}
        <Card title="Sales Order & Buyer" subtitle="Order specifications and destination">
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Order Number:</span>
              <span className="font-bold text-slate-900">{roll.order?.orderNo}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Buyer:</span>
              <span className="font-bold text-indigo-600">{roll.order?.buyer?.name || "N/A"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Fabric & Colour:</span>
              <span className="font-medium text-slate-800">
                {roll.order?.fabricType} • {roll.order?.colour} ({roll.order?.gsm} GSM)
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Order Status:</span>
              <Badge status={roll.order?.status || "PENDING"} />
            </div>
            {roll.order?.pricePerMetre != null && (
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Price per Metre:</span>
                <span className="font-bold text-slate-900">₹{roll.order.pricePerMetre}</span>
              </div>
            )}
          </div>
        </Card>

        {/* Machine & Production Lineage */}
        <Card title="Manufacturing Lineage" subtitle="Floor machine and shift tracking">
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Machine:</span>
              <span className="font-bold text-slate-900">
                {roll.machine?.name} ({roll.machine?.type?.toUpperCase()})
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Machine Status:</span>
              <Badge status={roll.machine?.status || "RUNNING"} />
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Production Shift:</span>
              <span className="font-semibold text-slate-800">{roll.shift}</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Capacity per Shift:</span>
              <span className="font-medium text-slate-700">
                {roll.machine?.capacityMetresPerShift} metres
              </span>
            </div>
          </div>
        </Card>

        {/* Yarn Lot Traceability */}
        <Card title="Yarn Lot Traceability" subtitle="Raw material input and supplier details">
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Yarn Lot No:</span>
              <span className="font-bold text-slate-900">{roll.yarnLot?.lotNo}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Yarn Material & Count:</span>
              <span className="font-medium text-slate-800">
                {roll.yarnLot?.yarnType?.name} ({roll.yarnLot?.yarnType?.count} • {roll.yarnLot?.yarnType?.material})
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Supplier:</span>
              <span className="font-semibold text-slate-800">
                {roll.yarnLot?.supplier?.name || "Direct Supply"}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Cost per Kg:</span>
              <span className="font-bold text-slate-900">
                ₹{roll.yarnLot?.yarnType?.costPerKg}
              </span>
            </div>
          </div>
        </Card>

        {/* Dispatch & Delivery Status */}
        <Card title="Dispatch & Delivery Status" subtitle="Warehouse logistics and transit">
          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-100">
              <span className="text-slate-500">Dispatch Status:</span>
              <span className="font-bold text-slate-900">
                {roll.dispatchId ? "Dispatched on Truck" : "Ready for Loading in Store"}
              </span>
            </div>
            {roll.dispatch ? (
              <>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Truck Number:</span>
                  <span className="font-bold text-indigo-700">{roll.dispatch.truckNo}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="text-slate-500">Dispatched At:</span>
                  <span className="font-medium text-slate-800">
                    {new Date(roll.dispatch.dispatchedAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Linked Invoice:</span>
                  <span className="font-mono text-slate-700">
                    {roll.dispatch.invoiceId || "Generated"}
                  </span>
                </div>
              </>
            ) : (
              <div className="p-3 bg-emerald-50 rounded-lg text-emerald-800 text-xs font-medium">
                {roll.qcStatus === "PASS"
                  ? "✓ Roll has passed inspection and is ready to be assigned to a dispatch truck."
                  : "⚠ Roll must achieve PASS QC status before it can be dispatched."}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Inspection History Log */}
      <Card
        title="Quality Control Inspection History"
        subtitle={`Recorded inspections (${roll.qcRecords?.length || 0})`}
      >
        {(!roll.qcRecords || roll.qcRecords.length === 0) ? (
          <p className="text-xs text-slate-400 py-3">No QC inspections recorded yet. Status is PENDING.</p>
        ) : (
          <div className="space-y-3">
            {roll.qcRecords.map((rec, idx) => (
              <QcRecordRow key={rec.id || idx} rec={rec} rollId={roll.id} canReverse={!roll.dispatchId} onReversed={refetch} />
            ))}
          </div>
        )}
      </Card>

      {/* Label Modal */}
      {showPrintModal && <RollLabelModal roll={roll} onClose={() => setShowPrintModal(false)} />}

      <Drawer isOpen={editing} onClose={() => setEditing(false)} title={`Edit ${roll.rollNo}`}>
        <EditRollForm
          roll={roll}
          onSaved={() => {
            setEditing(false);
            refetch();
          }}
        />
      </Drawer>
    </div>
  );
}

// The slice of /api/rolls/mint-options this form reads.
type WorkOrderLots = { order?: { id: string }; yarnLots?: { id: string; lotNo: string; yarnType: string }[] };

function EditRollForm({ roll, onSaved }: { roll: RollRow; onSaved: () => void }) {
  const [shift, setShift] = useState(roll.shift ?? "");
  const [yarnLotId, setYarnLotId] = useState(roll.yarnLotId ?? "");
  const [lengthMetres, setLengthMetres] = useState(String(roll.lengthMetres ?? ""));
  const [weightKg, setWeightKg] = useState(String(roll.weightKg ?? ""));
  const [lots, setLots] = useState<{ id: string; lotNo: string; yarnType: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/rolls/mint-options");
      if (!res.ok || cancelled) return;
      const data = await res.json().catch(() => null);
      const forThisOrder = ((data?.workOrders ?? []) as WorkOrderLots[]).filter((wo) => wo.order?.id === roll.order?.id);
      const byId = new Map<string, { id: string; lotNo: string; yarnType: string }>();
      for (const wo of forThisOrder) for (const l of wo.yarnLots ?? []) byId.set(l.id, l);
      if (!byId.has(roll.yarnLotId) && roll.yarnLot) {
        byId.set(roll.yarnLotId, { id: roll.yarnLotId, lotNo: roll.yarnLot.lotNo, yarnType: roll.yarnLot.yarnType?.name ?? "" });
      }
      if (!cancelled) setLots([...byId.values()]);
    })();
    return () => {
      cancelled = true;
    };
  }, [roll.order?.id, roll.yarnLotId, roll.yarnLot]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await fetch(`/api/rolls/${roll.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shift, yarnLotId, lengthMetres: Number(lengthMetres), weightKg: Number(weightKg) }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      const msg = typeof body?.fieldErrors === "object" ? Object.values(body.fieldErrors)[0] : body?.error;
      setError((Array.isArray(msg) ? msg[0] : msg) ?? "Couldn't save the roll");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input label="Shift" value={shift} onChange={(e) => setShift(e.target.value)} />
      <Select label="Yarn Lot" value={yarnLotId} onChange={(e) => setYarnLotId(e.target.value)}>
        {lots.map((l) => (
          <option key={l.id} value={l.id}>
            {l.lotNo} ({l.yarnType})
          </option>
        ))}
      </Select>
      <Input label="Length (metres)" type="number" step="0.01" min="0" value={lengthMetres} onChange={(e) => setLengthMetres(e.target.value)} />
      <Input label="Weight (kg)" type="number" step="0.01" min="0" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
      {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}
      <Button type="submit" isLoading={submitting}>
        Save changes
      </Button>
    </form>
  );
}

function QcRecordRow({ rec, rollId, canReverse, onReversed }: { rec: QcRecord; rollId: string; canReverse: boolean; onReversed: () => void }) {
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  let defectList: string[] = [];
  try {
    defectList = JSON.parse(rec.defects || "[]");
  } catch {
    defectList = [];
  }

  async function submitReversal(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) {
      setError("Say why the inspection is being reversed");
      return;
    }
    setError(null);
    setSubmitting(true);
    const res = await fetch(`/api/rolls/${rollId}/qc/${rec.id}/reversal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(body?.error ?? "Couldn't reverse the inspection");
      return;
    }
    setReversing(false);
    onReversed();
  }

  return (
    <div className={`p-4 rounded-xl border space-y-2 text-xs ${rec.reversal ? "border-slate-200 bg-slate-50 opacity-70" : "border-slate-200/80 bg-slate-50/50"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge status={rec.result} />
          <span className={`font-bold ${rec.reversal ? "text-slate-500 line-through" : "text-slate-800"}`}>Inspector: {rec.inspectorName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{new Date(rec.inspectedAt).toLocaleString()}</span>
          {!rec.reversal && canReverse && !reversing && (
            <Button variant="ghost" size="sm" onClick={() => setReversing(true)}>
              Reverse
            </Button>
          )}
        </div>
      </div>

      {rec.reversal && (
        <p className="text-slate-500">
          Reversed by {rec.reversal.reversedByName} on {new Date(rec.reversal.createdAt).toLocaleString()}: {rec.reversal.reason}
        </p>
      )}

      {defectList.length > 0 && (
        <div className="flex items-center gap-1.5 pt-1">
          <span className="text-[11px] font-semibold text-rose-700">Identified Defects:</span>
          <div className="flex flex-wrap gap-1">
            {defectList.map((d: string) => (
              <span key={d} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 uppercase">
                {d.replace("_", " ")}
              </span>
            ))}
          </div>
        </div>
      )}

      {rec.notes && (
        <div className="text-slate-600 bg-white p-2 rounded border border-slate-100">
          <span className="font-semibold text-slate-500">Notes: </span>
          {rec.notes}
        </div>
      )}

      {reversing && (
        <form onSubmit={submitReversal} className="flex flex-col gap-2 pt-2 border-t border-slate-200">
          <textarea
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={2}
            placeholder="Why is this inspection being reversed?"
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <p className="text-rose-600 font-medium">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" size="sm" isLoading={submitting}>
              Reverse inspection
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setReversing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
