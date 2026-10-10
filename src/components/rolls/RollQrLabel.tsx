"use client";

import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Printer, Download, Check } from "lucide-react";

interface RollQrLabelProps {
  roll: {
    id: string;
    rollNo: string;
    qrToken: string;
    lengthMetres: number;
    weightKg: number;
    qcStatus: string;
    shift: string;
    order?: { orderNo: string; fabricType?: string; colour?: string };
    machine?: { name: string; type?: string };
    yarnLot?: { lotNo: string; yarnType?: { name: string } };
  };
}

export function RollQrLabel({ roll }: RollQrLabelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      // The QR code encodes either the direct scan URL or the token
      const qrData = `${window.location.origin}/rolls/${roll.id}?token=${roll.qrToken}`;
      QRCode.toCanvas(canvasRef.current, qrData, {
        width: 160,
        margin: 1,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      });
    }
  }, [roll]);

  const handlePrint = () => {
    window.print();
  };

  const handleCopyToken = () => {
    navigator.clipboard.writeText(roll.qrToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (canvasRef.current) {
      const link = document.createElement("a");
      link.download = `QR-${roll.rollNo}.png`;
      link.href = canvasRef.current.toDataURL("image/png");
      link.click();
    }
  };

  return (
    <div className="space-y-4">
      {/* Printable Card Area */}
      <div className="printable-area bg-white border-2 border-slate-900 rounded-xl p-6 shadow-sm max-w-md mx-auto">
        <div className="flex items-center justify-between border-b-2 border-slate-900 pb-3 mb-4">
          <div>
            <h2 className="text-xl font-black tracking-tight text-slate-900">EVEREST MILLS</h2>
            <p className="text-xs uppercase font-bold tracking-widest text-slate-500">ThreadLine System</p>
          </div>
          <Badge status={roll.qcStatus} />
        </div>

        <div className="flex gap-4 items-center">
          <div className="bg-white p-1 rounded-lg border border-slate-200 shrink-0">
            <canvas ref={canvasRef} />
          </div>

          <div className="space-y-1.5 text-xs text-slate-700 min-w-0 flex-1">
            <div>
              <span className="font-semibold text-slate-500 uppercase block text-[10px]">Roll No</span>
              <span className="text-base font-bold text-slate-950 truncate block">{roll.rollNo}</span>
            </div>
            <div>
              <span className="font-semibold text-slate-500 uppercase block text-[10px]">Order No</span>
              <span className="font-medium text-slate-900">{roll.order?.orderNo || "N/A"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
              <div>
                <span className="text-slate-500 text-[10px] uppercase block">Machine</span>
                <span className="font-semibold text-slate-800">{roll.machine?.name || "N/A"}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[10px] uppercase block">Shift</span>
                <span className="font-semibold text-slate-800">{roll.shift}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t-2 border-slate-900 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-slate-50 rounded p-1.5">
            <span className="text-[10px] text-slate-500 uppercase block">Length</span>
            <span className="font-bold text-slate-900">{roll.lengthMetres} m</span>
          </div>
          <div className="bg-slate-50 rounded p-1.5">
            <span className="text-[10px] text-slate-500 uppercase block">Weight</span>
            <span className="font-bold text-slate-900">{roll.weightKg} kg</span>
          </div>
          <div className="bg-slate-50 rounded p-1.5">
            <span className="text-[10px] text-slate-500 uppercase block">Yarn Lot</span>
            <span className="font-bold text-slate-900 truncate block">{roll.yarnLot?.lotNo || "N/A"}</span>
          </div>
        </div>

        <div className="mt-3 text-center">
          <span className="text-[10px] font-mono text-slate-400 break-all">
            Token: {roll.qrToken}
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="no-print flex flex-wrap items-center justify-center gap-2 pt-2">
        <Button variant="primary" size="sm" onClick={handlePrint}>
          <Printer className="w-4 h-4 mr-1.5" />
          Print Label
        </Button>
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="w-4 h-4 mr-1.5" />
          Download QR
        </Button>
        <Button variant="ghost" size="sm" onClick={handleCopyToken}>
          {copied ? <Check className="w-4 h-4 mr-1.5 text-emerald-600" /> : null}
          {copied ? "Copied" : "Copy Token"}
        </Button>
      </div>
    </div>
  );
}
