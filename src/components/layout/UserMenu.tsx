"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Command, Keyboard, LogOut, Monitor, Moon, Settings, Sun, UserRound } from "lucide-react";
import type { Preferences } from "@/lib/preferences";
import { Avatar } from "./Avatar";
import { LogoutButton } from "./LogoutButton";
import { displayName, useShell } from "./ShellProvider";
import { ROLE_LABEL } from "./nav-config";

const THEME_CHOICES: { value: Preferences["theme"]; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

// The header's account control: a large avatar that opens a menu with the
// profile, settings, a quick theme switch, shortcuts and sign-out (which used
// to live at the foot of the sidebar).
export function UserMenu() {
  const { user, prefs, setPref, setPaletteOpen, setShortcutsOpen } = useShell();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const name = displayName(user);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-gray-700 transition-colors hover:bg-surface-container hover:text-foreground focus-visible:bg-surface-container";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="group flex items-center gap-2.5 rounded-md py-1 pl-1.5 pr-2 transition-colors hover:bg-surface-container"
      >
        <span className="hidden flex-col text-right leading-tight sm:flex">
          <span className="max-w-40 truncate text-[13px] font-semibold text-foreground">{name}</span>
          <span className="label-caps-sm text-gray-500">{ROLE_LABEL[user.role].title}</span>
        </span>
        <Avatar name={name} src={user.avatar} className="h-11 w-11 text-base ring-2 ring-transparent transition-shadow group-hover:ring-brand/30" />
        <ChevronDown className={`hidden h-4 w-4 text-gray-500 transition-transform sm:block ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-72 max-w-[calc(100vw-1.5rem)] origin-top-right animate-pop-in overflow-hidden rounded-md border border-border bg-white shadow-lg"
        >
          <div className="flex items-center gap-3 border-b border-border bg-surface-low px-4 py-3.5">
            <Avatar name={name} src={user.avatar} className="h-14 w-14 text-xl" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
              <p className="truncate text-xs text-gray-500">{user.email ?? `@${user.name}`}</p>
              <span className="label-caps-sm mt-1 inline-block bg-brand-soft px-1.5 py-0.5 text-brand">{ROLE_LABEL[user.role].title}</span>
            </div>
          </div>

          <div className="py-1">
            <Link href="/profile" role="menuitem" className={item} onClick={() => setOpen(false)}>
              <UserRound className="h-4 w-4 text-gray-500" aria-hidden="true" />
              View profile
            </Link>
            <Link href="/profile?tab=preferences" role="menuitem" className={item} onClick={() => setOpen(false)}>
              <Settings className="h-4 w-4 text-gray-500" aria-hidden="true" />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                setPaletteOpen(true);
              }}
            >
              <Command className="h-4 w-4 text-gray-500" aria-hidden="true" />
              Command menu
              <kbd className="ml-auto border border-border bg-surface-low px-1.5 text-[10px] font-semibold text-gray-500">Ctrl K</kbd>
            </button>
            <button
              type="button"
              role="menuitem"
              className={item}
              onClick={() => {
                setOpen(false);
                setShortcutsOpen(true);
              }}
            >
              <Keyboard className="h-4 w-4 text-gray-500" aria-hidden="true" />
              Keyboard shortcuts
              <kbd className="ml-auto border border-border bg-surface-low px-1.5 text-[10px] font-semibold text-gray-500">?</kbd>
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
            <span className="label-caps-sm text-gray-500">Theme</span>
            <div className="flex border border-border" role="radiogroup" aria-label="Theme">
              {THEME_CHOICES.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={prefs.theme === value}
                  title={label}
                  onClick={() => setPref("theme", value)}
                  className={`p-1.5 transition-colors ${
                    prefs.theme === value ? "bg-brand text-white" : "text-gray-500 hover:bg-surface-container hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border py-1">
            <LogoutButton className={`${item} hover:!text-red-700`}>
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </LogoutButton>
          </div>
        </div>
      )}
    </div>
  );
}
