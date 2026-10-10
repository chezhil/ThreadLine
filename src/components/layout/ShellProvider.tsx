"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Preferences } from "@/lib/preferences";
import type { Role } from "@/lib/auth";

// The signed-in user's profile and interface preferences, for every client
// component in the app shell. The server renders the initial values from the
// database (so there is no flash of the wrong theme or a sidebar that snaps
// shut after load); changes apply instantly here and are saved in the
// background.

export interface ShellUser {
  id: string;
  name: string;
  role: Role;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  avatar: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface ShellState {
  user: ShellUser;
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  setUser: (patch: Partial<ShellUser>) => void;
  /** Whether the preference save last failed (shown on the settings page). */
  saveError: string | null;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

/** Like useShell, but null outside the provider (for shared components). */
export function useShellOptional(): ShellState | null {
  return useContext(ShellContext);
}

/** The name to show for a person: their full name when set, else the username. */
export function displayName(u: Pick<ShellUser, "name" | "fullName">): string {
  return u.fullName?.trim() || u.name;
}

export function ShellProvider({
  initialUser,
  initialPrefs,
  children,
}: {
  initialUser: ShellUser;
  initialPrefs: Preferences;
  children: ReactNode;
}) {
  const [user, setUserState] = useState(initialUser);
  const [prefs, setPrefs] = useState(initialPrefs);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Changes made in quick succession are sent as one request.
  const pending = useRef<Partial<Preferences>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    timer.current = null;
    const body = pending.current;
    pending.current = {};
    if (!Object.keys(body).length) return;
    try {
      const res = await fetch("/api/me/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { fieldErrors?: Record<string, string[]>; error?: string } | null;
        setSaveError(Object.values(data?.fieldErrors ?? {}).flat()[0] ?? data?.error ?? "Couldn't save your preferences");
      } else {
        setSaveError(null);
      }
    } catch {
      setSaveError("Couldn't reach the server to save your preferences");
    }
  }, []);

  const setPref = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPrefs((p) => ({ ...p, [key]: value }));
      pending.current = { ...pending.current, [key]: value };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, 400);
    },
    [flush],
  );

  // Don't lose a toggle made just before navigating away.
  useEffect(() => {
    const onHide = () => {
      if (!Object.keys(pending.current).length) return;
      const body = JSON.stringify(pending.current);
      pending.current = {};
      navigator.sendBeacon?.("/api/me/preferences", new Blob([body], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const setUser = useCallback((patch: Partial<ShellUser>) => setUserState((u) => ({ ...u, ...patch })), []);

  const value = useMemo<ShellState>(
    () => ({ user, prefs, setPref, setUser, saveError, paletteOpen, setPaletteOpen, shortcutsOpen, setShortcutsOpen }),
    [user, prefs, setPref, setUser, saveError, paletteOpen, shortcutsOpen],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}
