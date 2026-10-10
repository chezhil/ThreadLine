import type { Role } from "@/lib/auth";
import { navForRole, type NavItem } from "./nav-config";

// One table drives the "g then …" go-to shortcuts, the shortcuts dialog and
// the hints in the command menu, so they can't drift apart.
const GO_KEYS: Record<string, string> = {
  "/dashboard": "d",
  "/orders": "o",
  "/production/floor-board": "p",
  "/quality/qc": "q",
  "/inventory": "i",
  "/dispatch": "t",
  "/accounts": "a",
  "/approvals": "v",
  "/alerts": "l",
  "/assistant": "e",
  "/audit": "u",
};

export const PROFILE_GO_KEYS = { "/profile": "m", "/profile?tab=preferences": "s" } as const;

export function goKeyFor(href: string): string | undefined {
  return GO_KEYS[href] ?? (PROFILE_GO_KEYS as Record<string, string>)[href];
}

/** Pages a role can jump to with `g` + key. */
export function goTargets(role: Role): { key: string; href: string; label: string }[] {
  const pages = navForRole(role)
    .map((i: NavItem) => ({ key: GO_KEYS[i.href], href: i.href, label: i.label }))
    .filter((t): t is { key: string; href: string; label: string } => !!t.key);
  return [...pages, { key: "m", href: "/profile", label: "My profile" }, { key: "s", href: "/profile?tab=preferences", label: "Settings" }];
}

/** True when the keyboard event came from somewhere the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}
