"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import type { Role } from "@/lib/auth";
import { RealtimeEvents } from "@/lib/realtime";
import { useRealtimeEvent } from "@/lib/useRealtime";
import { statusBadgeClass } from "@/lib/tokens";
import { severityStatus } from "@/lib/accounts/alert-format";
import dynamic from "next/dynamic";
import { useShell } from "./ShellProvider";
import { goTargets, isTypingTarget } from "./shortcuts";
import { beep } from "./sound";

// Everything in the shell that floats above the page: the command menu, the
// shortcuts help, live-alert toasts, the thin route-change progress bar, and
// the global keyboard handler that drives them.
// The command menu (and its order search) loads the first time it's opened.
const CommandPalette = dynamic(() => import("./CommandPalette").then((m) => m.CommandPalette), { ssr: false });

export function ShellOverlays({ role }: { role: Role }) {
  const { paletteOpen } = useShell();
  return (
    <>
      <RouteProgress />
      <GlobalKeys role={role} />
      {paletteOpen && <CommandPalette role={role} />}
      <ShortcutsDialog role={role} />
      <ToastHost />
    </>
  );
}

// ---------------------------------------------------------------- keyboard --

function GlobalKeys({ role }: { role: Role }) {
  const router = useRouter();
  const { prefs, setPref, setPaletteOpen, paletteOpen, shortcutsOpen, setShortcutsOpen } = useShell();
  const awaitingGo = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const targets = goTargets(role);
    const stopGo = () => {
      if (awaitingGo.current) clearTimeout(awaitingGo.current);
      awaitingGo.current = null;
    };

    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      // Single-key shortcuts must never fire while typing, with a dialog
      // open, or with a modifier held (that would hijack browser shortcuts).
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || paletteOpen) return;
      if (e.key === "Escape" && shortcutsOpen) {
        setShortcutsOpen(false);
        return;
      }
      if (shortcutsOpen) return;

      if (awaitingGo.current) {
        const hit = targets.find((t) => t.key === e.key.toLowerCase());
        stopGo();
        if (hit) {
          e.preventDefault();
          router.push(hit.href);
        }
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === "[") {
        e.preventDefault();
        setPref("sidebarCollapsed", !prefs.sidebarCollapsed);
      } else if (e.key.toLowerCase() === "g") {
        awaitingGo.current = setTimeout(stopGo, 1200);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopGo();
    };
  }, [role, router, prefs.sidebarCollapsed, setPref, paletteOpen, setPaletteOpen, shortcutsOpen, setShortcutsOpen]);

  return null;
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="min-w-6 border border-border-strong bg-surface-low px-1.5 py-0.5 text-center text-[11px] font-semibold text-gray-700 shadow-2xs">{children}</kbd>;
}

function ShortcutsDialog({ role }: { role: Role }) {
  const { shortcutsOpen, setShortcutsOpen } = useShell();
  if (!shortcutsOpen) return null;
  const rows: [string[], string][] = [
    [["Ctrl", "K"], "Open the command menu"],
    [["?"], "Show this help"],
    [["["], "Collapse or expand the sidebar"],
    [["Esc"], "Close a menu or dialog"],
  ];
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]" onMouseDown={() => setShortcutsOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="max-h-[85vh] w-full max-w-lg animate-pop-in overflow-y-auto rounded-md border border-border bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-[15px] font-semibold text-foreground">Keyboard shortcuts</h2>
          <button type="button" autoFocus onClick={() => setShortcutsOpen(false)} aria-label="Close" className="rounded-md p-1 text-gray-500 hover:bg-surface-container hover:text-foreground">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-5 px-5 py-4">
          <section>
            <h3 className="label-caps mb-2 text-gray-500">General</h3>
            <ul className="space-y-1.5">
              {rows.map(([keys, label]) => (
                <li key={label} className="flex items-center justify-between gap-4 text-[13px] text-gray-700">
                  {label}
                  <span className="flex gap-1">{keys.map((k) => <Key key={k}>{k}</Key>)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="label-caps mb-2 text-gray-500">Go to (press G, then…)</h3>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {goTargets(role).map((t) => (
                <li key={t.href} className="flex items-center justify-between gap-3 text-[13px] text-gray-700">
                  <span className="truncate">{t.label}</span>
                  <span className="flex gap-1"><Key>G</Key><Key>{t.key.toUpperCase()}</Key></span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- toasts --

interface Toast {
  id: string;
  message: string;
  severity: string;
}

function ToastHost() {
  const { prefs } = useShell();
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setToasts((all) => all.filter((x) => x.id !== id));
  }, []);

  useRealtimeEvent<{ id?: string; message?: string; severity?: string }>(RealtimeEvents.NotificationNew, (n) => {
    if (!n?.message) return;
    if (prefs.alertSound) beep();
    if (!prefs.toastNewAlerts) return;
    const id = n.id ?? `${Date.now()}`;
    setToasts((all) => [{ id, message: n.message!, severity: n.severity ?? "info" }, ...all.filter((x) => x.id !== id)].slice(0, 3));
    const prev = timers.current.get(id);
    if (prev) clearTimeout(prev);
    timers.current.set(id, setTimeout(() => dismiss(id), 8000));
  });

  useEffect(() => {
    const live = timers.current;
    return () => {
      live.forEach(clearTimeout);
      live.clear();
    };
  }, []);

  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 md:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} role="status" className="pointer-events-auto animate-toast-in rounded-md border border-border bg-white p-3 shadow-lg">
          <div className="flex items-start gap-2.5">
            <Bell className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <span className={`label-caps-sm border px-1.5 py-0.5 ${statusBadgeClass(severityStatus(t.severity))}`}>{t.severity}</span>
              <p className="mt-1.5 text-[13px] leading-5 text-foreground">{t.message}</p>
              <button
                type="button"
                onClick={() => {
                  dismiss(t.id);
                  router.push("/alerts");
                }}
                className="mt-1.5 text-xs font-semibold text-brand hover:underline"
              >
                Open alerts
              </button>
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded p-0.5 text-gray-400 hover:text-foreground">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------ route progress --

// A thin bar across the top that starts when a same-site link is clicked and
// finishes when the new page has arrived — instant feedback on slow networks.
function RouteProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "running" | "done">("idle");
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (settle.current) clearTimeout(settle.current);
      setState("running");
      // If the navigation never lands (error, cancelled), don't hang forever.
      if (fallback.current) clearTimeout(fallback.current);
      fallback.current = setTimeout(() => setState("idle"), 10000);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (fallback.current) clearTimeout(fallback.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (fallback.current) clearTimeout(fallback.current);
    // Deferred so the state change isn't made synchronously inside the effect.
    const finish = setTimeout(() => {
      setState("done");
      settle.current = setTimeout(() => setState("idle"), 260);
    }, 0);
    return () => clearTimeout(finish);
  }, [pathname]);

  if (state === "idle") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5" role="presentation">
      <div
        className={`h-full origin-left bg-brand-tint shadow-[0_0_8px_var(--brand-tint)] ${
          state === "running" ? "animate-route-progress" : "scale-x-100 opacity-0 transition-[opacity] duration-200"
        }`}
        style={state === "done" ? { transform: "scaleX(1)" } : undefined}
      />
    </div>
  );
}
