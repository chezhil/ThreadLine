"use client";
import { useRef, type ReactNode } from "react";
import { useShellOptional } from "@/components/layout/ShellProvider";

/** A titled block of settings, with an optional one-line explanation. */
/** Same look as <Card>, without its padding (sections pad their own rows). */
export const PLAIN_CARD = "rounded-md border border-border/80 bg-white shadow-sm";

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className={PLAIN_CARD}>
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-gray-500">{description}</p>}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

/** One setting: what it is on the left, the control on the right. */
export function Row({ label, description, htmlFor, children }: { label: string; description?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 sm:max-w-md">
        <label htmlFor={htmlFor} className="text-[13px] font-semibold text-foreground">
          {label}
        </label>
        {description && <p className="mt-0.5 text-xs leading-5 text-gray-500">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** An on/off switch. */
export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
        checked ? "border-brand bg-brand" : "border-border-strong bg-surface-container"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-[#ffffff] shadow-sm transition-transform ${checked ? "translate-x-[1.375rem]" : "translate-x-1"}`}
        aria-hidden="true"
      />
    </button>
  );
}

/** A small set of mutually exclusive choices. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex border border-border-strong">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
            value === o.value ? "bg-brand text-white" : "bg-white text-gray-700 hover:bg-surface-container"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Tilts its content a few degrees towards the pointer (a touch of 3D). It does
 * nothing for people who asked for reduced motion, and never on touch.
 */
export function Tilt({ children, className = "", max = 5 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const shell = useShellOptional();
  const reduced = shell?.prefs.reduceMotion ?? false;

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || reduced || e.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg)`;
  }
  function leave() {
    if (ref.current) ref.current.style.transform = "";
  }

  return (
    <div ref={ref} onPointerMove={move} onPointerLeave={leave} className={`transition-transform duration-200 ease-out will-change-transform ${className}`}>
      {children}
    </div>
  );
}

/** Inline "saved" / error line used under forms. */
export function FormNote({ kind, children }: { kind: "ok" | "error"; children: ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={`border-l-4 px-3 py-2 text-[13px] ${
        kind === "ok" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-red-600 bg-red-50 text-red-800"
      }`}
    >
      {children}
    </p>
  );
}
