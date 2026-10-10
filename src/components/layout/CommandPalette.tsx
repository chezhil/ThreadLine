"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  CornerDownLeft,
  FileText,
  Keyboard,
  LogOut,
  Moon,
  PanelLeft,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import type { Role } from "@/lib/auth";
import { useShell } from "./ShellProvider";
import { navForRole } from "./nav-config";
import { goKeyFor } from "./shortcuts";
import { signOut } from "./sign-out";

// Ctrl/Cmd+K: jump to any page, run a common action, or find an order by
// number, buyer or fabric. Orders are searched through the same endpoint the
// Orders page uses, so it only offers them to roles that may open it.
interface Item {
  id: string;
  label: string;
  hint?: string;
  group: "Pages" | "Account" | "Actions" | "Orders";
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

interface OrderHit {
  id: string;
  orderNo: string;
  fabricType: string;
  colour: string;
  status: string;
  buyer: { name: string };
}

const ic = "h-4 w-4";
// Results are shown grouped, so ranking happens within each group.
const GROUP_RANK: Record<Item["group"], number> = { Orders: 0, Pages: 1, Account: 2, Actions: 3 };

/** Subsequence match: every typed letter must appear in order. Lower = better. */
function score(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at >= 0) return at === 0 ? 0 : at < 3 ? 1 : 2;
  let i = 0;
  for (const ch of t) if (ch === q[i] && ++i === q.length) return 5;
  return null;
}

export function CommandPalette({ role }: { role: Role }) {
  const router = useRouter();
  const { paletteOpen, setPaletteOpen, setShortcutsOpen, prefs, setPref } = useShell();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [orders, setOrders] = useState<OrderHit[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const canSearchOrders = role === "owner";

  const close = useCallback(() => {
    setPaletteOpen(false);
    setQuery("");
    setActive(0);
    setOrders([]);
  }, [setPaletteOpen]);

  // Debounced order lookup; a stale response never overwrites a newer one.
  useEffect(() => {
    const q = query.trim();
    if (!paletteOpen || !canSearchOrders || q.length < 2) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/orders?q=${encodeURIComponent(q)}&page=1&pageSize=5`);
        if (!res.ok) return;
        const data = (await res.json()) as { orders?: OrderHit[] };
        if (!cancelled) setOrders(data.orders ?? []);
      } catch {
        // offline or server hiccup: the page/action results still work
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, paletteOpen, canSearchOrders]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      close();
      router.push(href);
    };
    const pages: Item[] = navForRole(role).map((n) => ({
      id: `page:${n.href}`,
      label: n.label,
      hint: goKeyFor(n.href) ? `G then ${goKeyFor(n.href)!.toUpperCase()}` : undefined,
      group: "Pages",
      icon: <n.icon className={ic} strokeWidth={1.75} aria-hidden="true" />,
      // Words from the URL too, so "floor board" finds Production.
      keywords: `${n.short} ${n.href.replace(/[/-]+/g, " ")}`,
      run: go(n.href),
    }));
    const account: Item[] = [
      { id: "acct:profile", label: "My profile", hint: "G then M", group: "Account", icon: <UserRound className={ic} aria-hidden="true" />, keywords: "name picture avatar email phone", run: go("/profile") },
      { id: "acct:settings", label: "Settings & preferences", hint: "G then S", group: "Account", icon: <Settings className={ic} aria-hidden="true" />, keywords: "theme dark mode appearance text size clock", run: go("/profile?tab=preferences") },
      { id: "acct:notifications", label: "Notification settings", group: "Account", icon: <Bell className={ic} aria-hidden="true" />, keywords: "alerts sound toast", run: go("/profile?tab=notifications") },
      { id: "acct:security", label: "Password & security", group: "Account", icon: <ShieldCheck className={ic} aria-hidden="true" />, keywords: "change password sessions devices", run: go("/profile?tab=security") },
      { id: "acct:activity", label: "My recent activity", group: "Account", icon: <FileText className={ic} aria-hidden="true" />, keywords: "history log", run: go("/profile?tab=activity") },
    ];
    const actions: Item[] = [
      {
        id: "act:theme",
        label: `Switch to ${prefs.theme === "dark" ? "light" : "dark"} theme`,
        group: "Actions",
        icon: <Moon className={ic} aria-hidden="true" />,
        keywords: "dark light mode appearance",
        run: () => {
          setPref("theme", prefs.theme === "dark" ? "light" : "dark");
          close();
        },
      },
      {
        id: "act:sidebar",
        label: prefs.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
        hint: "[",
        group: "Actions",
        icon: <PanelLeft className={ic} aria-hidden="true" />,
        keywords: "menu hide show navigation",
        run: () => {
          setPref("sidebarCollapsed", !prefs.sidebarCollapsed);
          close();
        },
      },
      {
        id: "act:shortcuts",
        label: "Keyboard shortcuts",
        hint: "?",
        group: "Actions",
        icon: <Keyboard className={ic} aria-hidden="true" />,
        keywords: "help keys",
        run: () => {
          close();
          setShortcutsOpen(true);
        },
      },
      {
        id: "act:signout",
        label: "Sign out",
        group: "Actions",
        icon: <LogOut className={ic} aria-hidden="true" />,
        keywords: "log out logout exit",
        run: () => {
          close();
          void signOut(router);
        },
      },
    ];
    const orderItems: Item[] = orders.map((o) => ({
      id: `order:${o.id}`,
      label: `${o.orderNo} · ${o.buyer.name}`,
      hint: `${o.fabricType} ${o.colour} · ${o.status.replace(/_/g, " ").toLowerCase()}`,
      group: "Orders",
      icon: <FileText className={ic} aria-hidden="true" />,
      run: go(`/orders/${o.id}`),
    }));
    return [...orderItems, ...pages, ...account, ...actions];
  }, [role, orders, prefs.theme, prefs.sidebarCollapsed, close, router, setPref, setShortcutsOpen]);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return items.filter((i) => i.group !== "Orders");
    return items
      .map((i) => ({ i, s: i.group === "Orders" ? 0 : score(q, `${i.label} ${i.keywords ?? ""}`) }))
      .filter((r): r is { i: Item; s: number } => r.s !== null)
      .sort((a, b) => GROUP_RANK[a.i.group] - GROUP_RANK[b.i.group] || a.s - b.s)
      .map((r) => r.i);
  }, [items, query]);

  // Keep the highlighted row in range and in view.
  const current = Math.min(active, Math.max(results.length - 1, 0));
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!paletteOpen) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      results[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command menu"
        className="w-full max-w-xl animate-pop-in overflow-hidden rounded-md border border-border bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              if (e.target.value.trim().length < 2) setOrders([]);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-results"
            aria-activedescendant={results[current] ? `cmd-${results[current].id}` : undefined}
            placeholder={canSearchOrders ? "Search pages, actions, orders, buyers…" : "Search pages and actions…"}
            className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-gray-400 focus-visible:outline-none"
          />
          <kbd className="border border-border bg-surface-low px-1.5 text-[10px] font-semibold text-gray-500">Esc</kbd>
        </div>

        <ul id="command-results" ref={listRef} role="listbox" className="scrollbar-thin max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">Nothing matches “{query.trim()}”.</li>}
          {results.map((item, index) => {
            const header = index === 0 || results[index - 1].group !== item.group ? item.group : null;
            return (
              <li key={item.id} role="presentation">
                {header && <p className="label-caps-sm px-4 pb-1 pt-2.5 text-gray-500">{header}</p>}
                <button
                  type="button"
                  id={`cmd-${item.id}`}
                  role="option"
                  aria-selected={index === current}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={item.run}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] ${
                    index === current ? "bg-brand-soft text-brand" : "text-gray-700"
                  }`}
                >
                  <span className={index === current ? "text-brand" : "text-gray-500"}>{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {item.hint && <span className="shrink-0 truncate text-[11px] text-gray-500">{item.hint}</span>}
                  {index === current && <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center justify-between border-t border-border bg-surface-low px-4 py-2 text-[11px] text-gray-500">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1"><kbd className="border border-border bg-white px-1">↑↓</kbd> move</span>
            <span className="flex items-center gap-1"><CornerDownLeft className="h-3 w-3" aria-hidden="true" /> open</span>
          </span>
          <span>ThreadLine command menu</span>
        </div>
      </div>
    </div>
  );
}
