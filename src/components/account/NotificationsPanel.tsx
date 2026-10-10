"use client";
import Link from "next/link";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui";
import { useShell } from "@/components/layout/ShellProvider";
import { beep } from "@/components/layout/sound";
import { FormNote, Row, Section, Toggle } from "./controls";

export function NotificationsPanel() {
  const { prefs, setPref, saveError } = useShell();
  return (
    <div className="flex flex-col gap-4">
      {saveError && <FormNote kind="error">{saveError}</FormNote>}

      <Section title="While you're using ThreadLine" description="How new mill alerts (breakdowns, low yarn, orders ready, payments) reach you on screen.">
        <Row label="Pop-up for new alerts" description="A small card in the corner the moment an alert is raised, with a shortcut to the alerts page. The bell in the header always counts them.">
          <Toggle checked={prefs.toastNewAlerts} onChange={(v) => setPref("toastNewAlerts", v)} label="Pop-up for new alerts" />
        </Row>
        <Row label="Play a sound" description="A short beep with each new alert. Browsers only allow sound after you've clicked or typed on the page once.">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={beep} aria-label="Play a test sound">
              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              Test
            </Button>
            <Toggle checked={prefs.alertSound} onChange={(v) => setPref("alertSound", v)} label="Play a sound" />
          </div>
        </Row>
      </Section>

      <Section title="Alert history" description="Everything raised for the mill, read and unread.">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <p className="text-[13px] text-gray-600">Open the full list to mark alerts read or review past ones.</p>
          <Link href="/alerts" className="shrink-0 text-[13px] font-semibold text-brand hover:underline">
            Go to alerts
          </Link>
        </div>
      </Section>
    </div>
  );
}
