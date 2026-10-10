import { z } from "zod";

// Per-user interface preferences, stored as JSON on User.preferences. Parsing
// is forgiving (unknown/old keys are dropped, bad values fall back to the
// default) so a stored blob can never break the shell.

export const THEMES = ["light", "dark", "system"] as const;
export const TEXT_SIZES = ["small", "default", "large"] as const;
export const TIME_FORMATS = ["24h", "12h"] as const;

// The fields carry no defaults on purpose: a PATCH schema built from them must
// only contain the keys the caller sent. (zod fills in a `.default()` even
// under `.partial()`, which would reset every other preference on each save.)
const fields = {
  theme: z.enum(THEMES),
  textSize: z.enum(TEXT_SIZES),
  sidebarCollapsed: z.boolean(),
  reduceMotion: z.boolean(),
  timeFormat: z.enum(TIME_FORMATS),
  showSeconds: z.boolean(),
  /** Page to open after signing in; empty = the role's usual home. */
  startPage: z.string().max(80),
  toastNewAlerts: z.boolean(),
  alertSound: z.boolean(),
};

export type Preferences = { [K in keyof typeof fields]: z.infer<(typeof fields)[K]> };

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  textSize: "default",
  sidebarCollapsed: false,
  reduceMotion: false,
  timeFormat: "24h",
  showSeconds: true,
  startPage: "",
  toastNewAlerts: true,
  alertSound: false,
};

/** Body of PATCH /api/me/preferences: any subset of the keys, nothing else. */
export const preferencesPatchSchema = z.object(fields).partial().strict();

export function parsePreferences(raw: string | null | undefined): Preferences {
  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
  } catch {
    // fall through to defaults
  }
  // Validate key by key so one bad value doesn't discard the rest.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]) {
    const ok = fields[key].safeParse(obj[key]);
    out[key] = ok.success ? ok.data : DEFAULT_PREFERENCES[key];
  }
  return out as Preferences;
}
