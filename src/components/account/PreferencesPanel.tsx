"use client";
import { Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { LiveClock } from "@/components/layout/LiveClock";
import { useShell } from "@/components/layout/ShellProvider";
import { navForRole } from "@/components/layout/nav-config";
import { DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import { ROLE_HOME } from "@/lib/role-home";
import { FormNote, Row, Section, Segmented, Toggle } from "./controls";

const THEME_CARDS: { value: Preferences["theme"]; label: string; hint: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", hint: "Bright, high-contrast", icon: Sun },
  { value: "dark", label: "Dark", hint: "Easy on the eyes at night", icon: Moon },
  { value: "system", label: "System", hint: "Follow this device", icon: Monitor },
];

/** A miniature of the app in each theme, so the choice is visual. */
function ThemeThumb({ mode }: { mode: Preferences["theme"] }) {
  const palette = (dark: boolean) =>
    dark
      ? { bg: "#050505", panel: "#0e0e0e", line: "#262626", bar: "#4a66dd", text: "#6b6b6b" }
      : { bg: "#f2f4f6", panel: "#ffffff", line: "#e0e3e5", bar: "#00288e", text: "#c4c5d5" };
  const half = (dark: boolean) => {
    const p = palette(dark);
    return (
      <div className="flex h-full w-full" style={{ background: p.bg }}>
        <div className="w-1/4 border-r" style={{ background: p.panel, borderColor: p.line }}>
          <div className="m-1.5 h-1.5 rounded-sm" style={{ background: p.bar }} />
          <div className="m-1.5 h-1 rounded-sm" style={{ background: p.text }} />
          <div className="m-1.5 h-1 rounded-sm" style={{ background: p.text }} />
        </div>
        <div className="flex-1 p-1.5">
          <div className="h-2 w-1/2 rounded-sm" style={{ background: p.bar }} />
          <div className="mt-1.5 h-5 rounded-sm border" style={{ background: p.panel, borderColor: p.line }} />
        </div>
      </div>
    );
  };
  return (
    <div className="relative h-16 w-full overflow-hidden border border-border" aria-hidden="true">
      {mode === "system" ? (
        <>
          {half(false)}
          {/* The right half is the dark version laid over the light one. */}
          <div className="absolute inset-0" style={{ clipPath: "polygon(50% 0, 100% 0, 100% 100%, 50% 100%)" }}>
            {half(true)}
          </div>
        </>
      ) : (
        half(mode === "dark")
      )}
    </div>
  );
}

export function PreferencesPanel() {
  const { user, prefs, setPref, saveError } = useShell();
  const pages = navForRole(user.role);

  function resetAll() {
    (Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]).forEach((k) => {
      // startPage and notification choices are left alone: "reset appearance".
      if (k === "startPage" || k === "toastNewAlerts" || k === "alertSound") return;
      setPref(k, DEFAULT_PREFERENCES[k] as never);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {saveError && <FormNote kind="error">{saveError} Your changes still apply on this screen.</FormNote>}

      <Section title="Appearance" description="How ThreadLine looks on every device you sign in on.">
        <div className="px-5 py-4">
          <p className="mb-3 text-[13px] font-semibold text-foreground">Theme</p>
          <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Theme">
            {THEME_CARDS.map(({ value, label, hint, icon: Icon }) => {
              const on = prefs.theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPref("theme", value)}
                  className={`flex flex-col gap-2.5 border p-2.5 text-left transition-colors ${
                    on ? "border-brand bg-brand-soft/60 ring-1 ring-brand" : "border-border hover:border-border-strong hover:bg-surface-low"
                  }`}
                >
                  <ThemeThumb mode={value} />
                  <span className="flex items-center gap-2 px-0.5">
                    <Icon className={`h-4 w-4 ${on ? "text-brand" : "text-gray-500"}`} aria-hidden="true" />
                    <span className="text-[13px] font-semibold text-foreground">{label}</span>
                  </span>
                  <span className="px-0.5 text-xs text-gray-500">{hint}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Row label="Text size" description="Scales the whole interface. Useful on large shop-floor screens or small phones.">
          <Segmented
            label="Text size"
            value={prefs.textSize}
            onChange={(v) => setPref("textSize", v)}
            options={[
              { value: "small", label: "Small" },
              { value: "default", label: "Default" },
              { value: "large", label: "Large" },
            ]}
          />
        </Row>
        <Row label="Reduce motion" description="Turns off page transitions, the loading bar and 3D effects. Also applied automatically if your device asks for it.">
          <Toggle checked={prefs.reduceMotion} onChange={(v) => setPref("reduceMotion", v)} label="Reduce motion" />
        </Row>
      </Section>

      <Section title="Workspace" description="Where you land and how the layout starts.">
        <Row label="Start page" description="Opened right after you sign in. Only pages your role can use are listed.">
          <Select
            aria-label="Start page"
            value={prefs.startPage}
            onChange={(e) => setPref("startPage", e.target.value)}
            options={[{ value: "", label: `Default (${pages.find((p) => p.href === ROLE_HOME[user.role])?.label ?? "home"})` }, ...pages.map((p) => ({ value: p.href, label: p.label }))]}
          />
        </Row>
        <Row label="Collapse the sidebar" description="Keep the navigation as a slim icon rail to give pages more room. You can also press [ at any time.">
          <Toggle checked={prefs.sidebarCollapsed} onChange={(v) => setPref("sidebarCollapsed", v)} label="Collapse the sidebar" />
        </Row>
      </Section>

      <Section title="Date & time" description="The mill clock always shows Indian Standard Time.">
        <Row label="Clock format">
          <Segmented
            label="Clock format"
            value={prefs.timeFormat}
            onChange={(v) => setPref("timeFormat", v)}
            options={[
              { value: "24h", label: "24-hour" },
              { value: "12h", label: "12-hour" },
            ]}
          />
        </Row>
        <Row label="Show seconds" description="A ticking seconds counter in the header and sidebar clock.">
          <div className="flex items-center gap-4">
            <LiveClock className="hidden text-[13px] font-semibold text-foreground sm:inline" />
            <Toggle checked={prefs.showSeconds} onChange={(v) => setPref("showSeconds", v)} label="Show seconds" />
          </div>
        </Row>
      </Section>

      <div className="flex justify-end">
        <Button variant="secondary" size="sm" onClick={resetAll}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset appearance to defaults
        </Button>
      </div>
    </div>
  );
}
