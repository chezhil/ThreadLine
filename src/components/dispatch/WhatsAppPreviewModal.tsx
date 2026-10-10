"use client";

import React, { useState, useEffect } from "react";
import { formatWhatsAppMessage, normalizeWhatsAppPhone, type DispatchWhatsAppPayload } from "@/lib/alerts/whatsapp-format";
import { Check, Copy, ExternalLink, ShieldCheck, X } from "lucide-react";

export interface WhatsAppPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  payload: DispatchWhatsAppPayload | null;
  /** What the server should message about; it rebuilds the text from its own records. */
  target: { dispatchId: string } | { orderId: string } | null;
  onSent?: (alertId: string) => void;
}

/**
 * Safely renders WhatsApp formatting:
 * - *bold* -> <strong>
 * - _italic_ -> <em>
 * - URLs -> clickable styled text
 * - Line breaks
 */
function renderWhatsAppFormattedText(text: string) {
  return text.split("\n").map((line, lineIdx) => {
    if (!line.trim()) {
      return <div key={lineIdx} className="h-2" />;
    }

    const parts = line.split(/(\*[^*]+\*|_[^_]+_)/g);
    return (
      <div key={lineIdx} className="min-h-[1.2rem]">
        {parts.map((part, partIdx) => {
          if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
            return (
              <strong key={partIdx} className="font-bold text-slate-900">
                {part.slice(1, -1)}
              </strong>
            );
          }
          if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
            return (
              <em key={partIdx} className="italic text-slate-600 text-[11px] block mt-1">
                {part.slice(1, -1)}
              </em>
            );
          }
          if (part.startsWith("http://") || part.startsWith("https://") || part.includes("/track/")) {
            return (
              <span key={partIdx} className="text-[#027eb5] underline break-all font-mono text-[11px]">
                {part}
              </span>
            );
          }
          return <span key={partIdx}>{part}</span>;
        })}
      </div>
    );
  });
}

export function WhatsAppPreviewModal({
  isOpen,
  onClose,
  payload,
  target,
  onSent,
}: WhatsAppPreviewModalProps) {
  const [copied, setCopied] = useState(false);
  const [loggingOutbox, setLoggingOutbox] = useState(false);
  const [outboxStatus, setOutboxStatus] = useState<string | null>(null);

  const handleClose = React.useCallback(() => {
    setCopied(false);
    setOutboxStatus(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen || !payload) return null;

  const phone = normalizeWhatsAppPhone(payload.buyerPhone);
  const formattedMessage = formatWhatsAppMessage({
    ...payload,
    appUrl: payload.appUrl ?? (typeof window !== "undefined" ? window.location.origin : undefined),
  });
  const currentTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy message:", err);
    }
  };

  const handleOpenInWhatsApp = async () => {
    if (!target || !phone) return;
    setLoggingOutbox(true);
    setOutboxStatus("Logging to outbox...");
    // Open the tab inside the click so popup blockers allow it, then point it
    // at WhatsApp once the server has recorded (and rate-checked) the send.
    const tab = window.open("", "_blank");

    try {
      const res = await fetch("/api/alerts/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.shareUrl) {
        setOutboxStatus("✓ Recorded in outbox");
        if (onSent && data.alertId) onSent(data.alertId);
        if (tab) tab.location.href = data.shareUrl;
        else window.location.href = data.shareUrl;
      } else {
        tab?.close();
        setOutboxStatus(`⚠️ ${data.error || "Couldn't record the message — not opened"}`);
      }
    } catch (err) {
      console.error("Failed to log alert to outbox:", err);
      tab?.close();
      setOutboxStatus("⚠️ Outbox offline — not opened");
    } finally {
      setLoggingOutbox(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-300 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* WhatsApp Brand Header Bar (#075E54) */}
        <div className="bg-[#075E54] text-white px-4 py-3 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-[#128C7E] border-2 border-white/40 flex items-center justify-center font-black text-white text-xs tracking-wider shadow-inner">
                ETM
              </div>
              <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-400 border-2 border-[#075E54] rounded-full" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight flex items-center gap-1.5">
                Everest Textile Mills
                <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded font-normal text-emerald-100">
                  Verified
                </span>
              </div>
              <div className="text-[11px] text-emerald-100/90 font-medium flex items-center gap-1">
                Official Dispatch Dispatcher
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-full hover:bg-white/10 transition-colors text-white/80 hover:text-white"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Recipient Details Sub-header */}
        <div className="bg-[#054c44] px-4 py-1.5 text-xs text-emerald-100 flex items-center justify-between border-t border-emerald-800/40 font-mono">
          <span>To: {payload.buyerName}</span>
          <span>{phone ? `+${phone}` : "no valid number"}</span>
        </div>

        {/* WhatsApp Chat Wallpaper (#EFEAE2) */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-3"
          style={{
            backgroundColor: "#EFEAE2",
            backgroundImage: "radial-gradient(#d3cbbe 1px, transparent 1px)",
            backgroundSize: "16px 16px",
          }}
        >
          {/* Date Chip */}
          <div className="flex justify-center">
            <span className="bg-white/90 text-slate-600 text-[10px] font-semibold px-2.5 py-0.5 rounded-full shadow-sm border border-slate-200/50 uppercase tracking-wider">
              Today
            </span>
          </div>

          {/* Incoming Message Bubble (#DCF8C6) */}
          <div className="flex justify-start max-w-[92%]">
            <div className="relative bg-[#DCF8C6] text-slate-800 rounded-2xl rounded-tl-none p-3.5 shadow-md border border-[#c3e8ab]/70 text-xs sm:text-sm leading-relaxed space-y-1">
              {/* Message Content */}
              <div className="text-slate-900 font-sans">
                {renderWhatsAppFormattedText(formattedMessage)}
              </div>

              {/* Timestamp */}
              <div className="flex items-center justify-end gap-1 pt-1 text-[10px] text-slate-500 font-medium">
                <span>{currentTime}</span>
              </div>
            </div>
          </div>

          {/* Security & Anti-Leak Audit Pill */}
          <div className="p-2.5 rounded-xl bg-white/90 border border-emerald-300 text-[11px] text-slate-700 flex items-start gap-2 shadow-sm">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="leading-tight">
              <span className="font-bold text-slate-900">Zero Cost Leakage Guarantee:</span>{" "}
              Weaver names, loom numbers, yarn purchase rates, and mill margins are stripped. Only live tracking and vehicle details are included.
            </div>
          </div>
        </div>

        {!phone && (
          <div className="px-4 py-1.5 bg-amber-50 border-t border-amber-200 text-[11px] text-amber-800">
            {payload.buyerName}&apos;s contact (&ldquo;{payload.buyerPhone || "empty"}&rdquo;) isn&apos;t a usable phone number, so this can&apos;t be sent. Fix it on the buyer record.
          </div>
        )}

        {/* Outbox Status Notification */}
        {outboxStatus && (
          <div className="px-4 py-1 bg-slate-100 border-t border-slate-200 text-[11px] text-slate-600 flex justify-between items-center font-mono">
            <span>Alert Outbox: {outboxStatus}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="p-3 bg-white border-t border-slate-200 flex flex-col sm:flex-row gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors shadow-sm"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-700 font-bold">Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-slate-500" />
                <span>Copy Message Text</span>
              </>
            )}
          </button>

          <button
            onClick={handleOpenInWhatsApp}
            disabled={loggingOutbox || !phone || !target}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white transition-colors shadow-md disabled:opacity-50"
          >
            <ExternalLink className="w-4 h-4" />
            <span>{loggingOutbox ? "Logging Outbox..." : "Open in WhatsApp"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
