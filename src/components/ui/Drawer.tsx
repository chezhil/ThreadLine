"use client";
import { ReactNode, useEffect, useId, useRef } from "react";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Drawer({ open, onClose, title, children }: DrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Keyboard users land inside the dialog, Escape closes it, and focus goes
  // back to whatever opened it.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("input, select, textarea, button:not([data-drawer-close])");
    (first ?? panel)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-gray-950/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-white shadow-xl outline-none"
      >
        <div className="flex items-center justify-between border-b border-border bg-surface-low px-4 py-3">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold text-foreground">
            <span className="h-3 w-3 bg-brand" aria-hidden="true" />
            {title}
          </h2>
          <button
            type="button"
            data-drawer-close
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-surface-container hover:text-foreground"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
