"use client";

import { useEffect, useId, useRef, type ComponentProps } from "react";
import { RollQrLabel } from "./RollQrLabel";

// The "print roll label" dialog shared by the QC queue, the rolls registry
// and a roll's detail page. Escape or a click on the backdrop closes it.
export function RollLabelModal({ roll, onClose }: { roll: ComponentProps<typeof RollQrLabel>["roll"]; onClose: () => void }) {
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-white rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b pb-3">
          <h3 id={titleId} className="font-bold text-slate-900 text-base">Print Roll Label</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            autoFocus
            className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
          >
            ✕
          </button>
        </div>
        <RollQrLabel roll={roll} />
      </div>
    </div>
  );
}
