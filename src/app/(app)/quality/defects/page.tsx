"use client";

import React, { useEffect, useState } from "react";
import { Card } from "@/components/quality/ui/Card";

import { Select } from "@/components/quality/ui/Select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/quality/ui/Table";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Sparkles,
} from "lucide-react";

// Shape of GET /api/analytics/defects.
interface DefectAnalytics {
  callouts: string[];
  summary: {
    totalInspected: number;
    totalPass: number;
    totalRework: number;
    totalReject: number;
    passRate: number;
    reworkRate: number;
    rejectRate: number;
  };
  byMachine: { id: string; name: string; type: string; total: number; pass: number; rework: number; reject: number; rejectRate: number; shareOfTotalRejects: number }[];
  byShift: { shift: string; total: number; pass: number; reject: number; rejectRate: number }[];
  byYarnLot: { id: string; lotNo: string; yarnTypeName: string; supplierName: string; total: number; reject: number; rejectRate: number }[];
  byDefectType: { type: string; label: string; count: number; percentage: number }[];
}

export default function DefectAnalyticsPage() {
  const [data, setData] = useState<DefectAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("30");

  useEffect(() => {
    async function fetchAnalytics() {
      setLoading(true);
      try {
        const res = await fetch(`/api/analytics/defects?days=${days}`);
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch (err) {
        console.warn("Failed to load defect analytics:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchAnalytics();
  }, [days]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Defect Root-Cause Analytics
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Query-driven rejection rates across machines, shifts, yarn lots, and defect classifications.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="text-xs py-1.5 w-36"
          >
            <option value="7">Last 7 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="90">Last 90 Days</option>
          </Select>
        </div>
      </div>

      {loading || !data ? (
        <div className="p-16 text-center text-slate-400 text-sm">
          <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          Analyzing quality control records and computing root causes...
        </div>
      ) : (
        <>
          {/* Plain-Language Query-Driven Callouts Banner */}
          {data.callouts && data.callouts.length > 0 && (
            <div className="bg-gradient-to-r from-amber-500/10 via-rose-500/10 to-indigo-500/10 p-5 rounded-2xl border border-amber-200/80 shadow-xs">
              <div className="flex items-center gap-2 text-amber-900 font-extrabold text-xs uppercase tracking-wider mb-2.5">
                <Sparkles className="w-4 h-4 text-amber-600" />
                Root-Cause Intelligence (Computed from Real Inspection Records)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.callouts.map((callout, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-white border border-amber-200/60 shadow-2xs"
                  >
                    <div className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                    <p className="text-xs font-semibold text-slate-800 leading-relaxed">
                      {callout}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top KPI Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card className="p-4">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                Total Inspected
              </span>
              <p className="text-2xl font-black text-slate-900 mt-1">
                {data.summary.totalInspected} rolls
              </p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">
                  Pass Rate
                </span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-2xl font-black text-emerald-700 mt-1">
                {data.summary.passRate.toFixed(1)}%
              </p>
              <span className="text-[10px] text-slate-500 font-medium">
                {data.summary.totalPass} rolls passed
              </span>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block">
                  Rework Rate
                </span>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-2xl font-black text-amber-700 mt-1">
                {data.summary.reworkRate.toFixed(1)}%
              </p>
              <span className="text-[10px] text-slate-500 font-medium">
                {data.summary.totalRework} rolls flagged
              </span>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wider block">
                  Rejection Rate
                </span>
                <XCircle className="w-4 h-4 text-rose-500" />
              </div>
              <p className="text-2xl font-black text-rose-700 mt-1">
                {data.summary.rejectRate.toFixed(1)}%
              </p>
              <span className="text-[10px] text-slate-500 font-medium">
                {data.summary.totalReject} rolls scrapped
              </span>
            </Card>
          </div>

          {/* Machine Rejection Analysis (Highlighting Loom 4) */}
          <Card
            title="Rejection Rate by Machine"
            subtitle="Identifies machines responsible for quality failures"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Machine</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Total Output</TableHead>
                  <TableHead>Pass</TableHead>
                  <TableHead>Rework</TableHead>
                  <TableHead>Rejects</TableHead>
                  <TableHead>Rejection Rate</TableHead>
                  <TableHead>Share of Rejects</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byMachine.map((m) => {
                  const isHighReject = m.rejectRate > 20 || m.shareOfTotalRejects > 40;
                  return (
                    <TableRow
                      key={m.id}
                      className={isHighReject ? "bg-rose-50/40" : ""}
                    >
                      <TableCell>
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          {m.name}
                          {isHighReject && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-rose-600 text-white">
                              High Risk
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="uppercase text-xs font-semibold text-slate-500">
                        {m.type}
                      </TableCell>
                      <TableCell className="font-semibold text-slate-800">
                        {m.total} rolls
                      </TableCell>
                      <TableCell className="text-emerald-700 font-medium">{m.pass}</TableCell>
                      <TableCell className="text-amber-700 font-medium">{m.rework}</TableCell>
                      <TableCell className="text-rose-700 font-bold">{m.reject}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full ${
                                isHighReject ? "bg-rose-600" : "bg-slate-400"
                              }`}
                              style={{ width: `${Math.min(m.rejectRate, 100)}%` }}
                            />
                          </div>
                          <span
                            className={`font-bold text-xs ${
                              isHighReject ? "text-rose-700" : "text-slate-700"
                            }`}
                          >
                            {m.rejectRate.toFixed(1)}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-xs text-slate-800">
                        {m.shareOfTotalRejects.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Defect Classification Breakdown */}
            <Card
              title="Defect Causes Breakdown"
              subtitle="Distribution of identified defect types"
            >
              <div className="space-y-3 pt-1">
                {data.byDefectType.map((d) => (
                  <div key={d.type} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold text-slate-800">{d.label}</span>
                      <span className="text-slate-500 font-medium">
                        {d.count} defects ({d.percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-indigo-600 h-full rounded-full transition-all"
                        style={{ width: `${d.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Shift Rejection Analysis */}
            <Card
              title="Performance by Shift"
              subtitle="Quality variations across operating shifts"
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Shift</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Pass</TableHead>
                    <TableHead>Rejects</TableHead>
                    <TableHead>Reject Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byShift.map((s) => (
                    <TableRow key={s.shift}>
                      <TableCell className="font-bold text-slate-900">{s.shift}</TableCell>
                      <TableCell>{s.total}</TableCell>
                      <TableCell className="text-emerald-700 font-medium">{s.pass}</TableCell>
                      <TableCell className="text-rose-700 font-bold">{s.reject}</TableCell>
                      <TableCell className="font-bold text-xs text-rose-700">
                        {s.rejectRate.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>

          {/* Rejection Rate by Yarn Lot */}
          <Card
            title="Defects by Raw Yarn Lot"
            subtitle="Cross-referencing defects back to yarn suppliers and lots"
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot Number</TableHead>
                  <TableHead>Yarn Material</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Rolls</TableHead>
                  <TableHead>Rejects</TableHead>
                  <TableHead>Reject Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byYarnLot.map((y) => (
                  <TableRow key={y.id}>
                    <TableCell className="font-bold text-slate-900">{y.lotNo}</TableCell>
                    <TableCell className="text-slate-700">{y.yarnTypeName}</TableCell>
                    <TableCell className="text-slate-700">{y.supplierName}</TableCell>
                    <TableCell className="font-semibold">{y.total}</TableCell>
                    <TableCell className="text-rose-700 font-bold">{y.reject}</TableCell>
                    <TableCell className="font-bold text-xs text-rose-700">
                      {y.rejectRate.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
