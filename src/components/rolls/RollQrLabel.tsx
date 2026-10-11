"use client";

import React, { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/quality/ui/Button";
import { Badge } from "@/components/quality/ui/Badge";
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

/** Prints just the label from a hidden iframe: the browser lays out one small
 * card instead of the whole app (printing the page with everything else made
 * invisible still laid out every row and froze on long pages), and nothing on
 * the page itself is touched, so a cancelled print can't leave it broken. */
function printLabel(area: HTMLElement, qrDataUrl: string, title: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) {
      frame.remove();
      resolve();
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      // Removed on the next tick: some browsers still read the frame right after print() returns.
      setTimeout(() => frame.remove(), 0);
      resolve();
    };

    doc.title = title;
    // The app's own stylesheets, so the label looks exactly as on screen.
    const sheets = [...document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style')].map(
      (el) => doc.importNode(el, true),
    );
    doc.head.append(...sheets);
    const page = doc.createElement("style");
    page.textContent = "@page{margin:8mm}html,body{margin:0;background:#fff}body{padding:4mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}";
    doc.head.append(page);

    const label = doc.importNode(area, true) as HTMLElement;
    const canvas = label.querySelector("canvas");
    if (canvas) {
      const img = doc.createElement("img");
      img.src = qrDataUrl;
      img.width = 160;
      img.height = 160;
      img.alt = "Roll QR code";
      canvas.replaceWith(img);
    }
    doc.body.append(label);

    // Wait for the stylesheets (bounded, so a slow or failed one can't hang the button).
    const pending = sheets
      .filter((el): el is HTMLLinkElement => el.tagName === "LINK")
      .map((link) => new Promise<void>((done) => { link.onload = () => done(); link.onerror = () => done(); }));
    Promise.race([Promise.all(pending), new Promise((done) => setTimeout(done, 2000))]).then(() => {
      win.addEventListener("afterprint", finish, { once: true });
      win.focus();
      win.print();
      // print() returns once the dialog closes in most browsers; afterprint is the backstop.
      setTimeout(finish, 1000);
    });
  });
}

export function RollQrLabel({ roll }: RollQrLabelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);
  // Printing focuses the print frame; focus goes back to what started the
  // print once the button is enabled again, so the keyboard keeps working.
  const refocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (printing || !refocus.current) return;
    window.focus();
    refocus.current.focus();
    refocus.current = null;
  }, [printing]);
  const qrData = `${typeof window === "undefined" ? "" : window.location.origin}/quality/rolls/${roll.id}?token=${roll.qrToken}`;

  // Keyed on the encoded text, not the roll object: a parent re-render (a
  // realtime refetch) hands over a new object for the same roll.
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrData, {
        width: 160,
        margin: 1,
        color: {
          dark: "#0f172a",
          light: "#ffffff",
        },
      }).catch((err: unknown) => console.warn("QR render failed:", err));
    }
  }, [qrData]);

  const handlePrint = async () => {
    if (printing || !areaRef.current || !canvasRef.current) return;
    refocus.current = document.activeElement as HTMLElement | null;
    setPrinting(true);
    try {
      await printLabel(areaRef.current, canvasRef.current.toDataURL("image/png"), `Roll label ${roll.rollNo}`);
    } finally {
      setPrinting(false);
    }
  };

  const handleCopyToken = () => {
    navigator.clipboard
      ?.writeText(roll.qrToken)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => window.prompt("Copy the roll token:", roll.qrToken));
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
      <div ref={areaRef} className="printable-area bg-white border-2 border-slate-900 rounded-xl p-6 shadow-sm max-w-md mx-auto">
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
        <Button variant="primary" size="sm" onClick={handlePrint} disabled={printing}>
          <Printer className="w-4 h-4 mr-1.5" />
          {printing ? "Printing…" : "Print Label"}
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
