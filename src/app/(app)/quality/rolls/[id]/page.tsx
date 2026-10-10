"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/quality/ui/Button";
import { Badge } from "@/components/quality/ui/Badge";
import { Card } from "@/components/quality/ui/Card";
import { RollQrLabel } from "@/components/rolls/RollQrLabel";
import {
  ArrowLeft,
  Printer,
  CheckSquare,
  Truck,
  Layers,
  Factory,
  Clock,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";

export default function RollDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const rollId = params.id as string;
  const qrTokenFromQuery = searchParams.get("token");

  const [roll, setRoll] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPrintModal, setShowPrintModal] = useState(false);

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
      } catch (err: any) {
        setError(err.message || "Failed to load roll details");
      } finally {
        setLoading(false);
      }
    }

    if (rollId) {
      fetchRoll();
    }
  }, [rollId, qrTokenFromQuery]);

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
            <Link href="/quality/qc">
              <Button variant="primary" size="sm">
                <CheckSquare className="w-4 h-4 mr-1.5" />
                Inspect in QC Queue
              </Button>
            </Link>
          )}
        </div>
      </div>

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
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Price per Metre:</span>
              <span className="font-bold text-slate-900">₹{roll.order?.pricePerMetre}</span>
            </div>
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
            {roll.qcRecords.map((rec: any, idx: number) => {
              let defectList: string[] = [];
              try {
                defectList = JSON.parse(rec.defects || "[]");
              } catch {
                defectList = [];
              }

              return (
                <div
                  key={rec.id || idx}
                  className="p-4 rounded-xl border border-slate-200/80 bg-slate-50/50 space-y-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge status={rec.result} />
                      <span className="font-bold text-slate-800">
                        Inspector: {rec.inspectorName ?? rec.inspectorId}
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {new Date(rec.inspectedAt).toLocaleString()}
                    </span>
                  </div>

                  {defectList.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <span className="text-[11px] font-semibold text-rose-700">Identified Defects:</span>
                      <div className="flex flex-wrap gap-1">
                        {defectList.map((d: string) => (
                          <span
                            key={d}
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 uppercase"
                          >
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
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Label Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-base">Print Roll Label</h3>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>
            <RollQrLabel roll={roll} />
          </div>
        </div>
      )}
    </div>
  );
}
