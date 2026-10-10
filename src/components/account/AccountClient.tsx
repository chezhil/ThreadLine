"use client";
import { useEffect, useState } from "react";
import { Bell, History, Settings2, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import { PageTitle } from "@/components/accounts/Stat";
import { ActivityPanel } from "./ActivityPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { PreferencesPanel } from "./PreferencesPanel";
import { ProfilePanel } from "./ProfilePanel";
import { SecurityPanel } from "./SecurityPanel";
import { isAccountTab, type AccountTab } from "./tabs";

// Profile & settings, in the layout most production apps use: a short list of
// sections on the left (a tab strip on phones) and one section's settings on
// the right. The section is kept in ?tab= so it can be linked and reloaded.
const ACCOUNT_TABS: { id: AccountTab; label: string; description: string; icon: LucideIcon }[] = [
  { id: "profile", label: "Profile", description: "Name, photo, contact details", icon: UserRound },
  { id: "preferences", label: "Preferences", description: "Theme, text size, clock, start page", icon: Settings2 },
  { id: "notifications", label: "Notifications", description: "Alert pop-ups and sound", icon: Bell },
  { id: "security", label: "Security", description: "Password and signed-in devices", icon: ShieldCheck },
  { id: "activity", label: "Activity", description: "Your recent changes", icon: History },
];

export function AccountClient({ initialTab }: { initialTab: AccountTab }) {
  const [tab, setTab] = useState<AccountTab>(initialTab);
  // The command menu and user menu link to /profile?tab=… without remounting
  // this page; when the server hands us a different tab, follow it.
  const [seenInitial, setSeenInitial] = useState(initialTab);
  if (seenInitial !== initialTab) {
    setSeenInitial(initialTab);
    setTab(initialTab);
  }

  // Back/forward between tabs.
  useEffect(() => {
    const onPop = () => {
      const t = new URLSearchParams(window.location.search).get("tab");
      setTab(isAccountTab(t) ? t : "profile");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function select(next: AccountTab) {
    setTab(next);
    const url = next === "profile" ? "/profile" : `/profile?tab=${next}`;
    window.history.pushState(null, "", url);
  }

  const active = ACCOUNT_TABS.find((t) => t.id === tab) ?? ACCOUNT_TABS[0];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <PageTitle title="Profile & settings" subtitle="Manage who you are in ThreadLine and how it looks and behaves for you." />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <nav aria-label="Profile sections" className="lg:sticky lg:top-28 lg:w-64 lg:shrink-0">
          <ul className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-0 lg:px-0">
            {ACCOUNT_TABS.map((t) => {
              const on = t.id === tab;
              const Icon = t.icon;
              return (
                <li key={t.id} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => select(t.id)}
                    aria-current={on ? "page" : undefined}
                    className={`flex w-full items-center gap-3 whitespace-nowrap border-b-2 px-3 py-2.5 text-left text-[13px] transition-colors lg:border-b-0 lg:border-l-2 lg:py-2.5 ${
                      on
                        ? "border-brand font-semibold text-brand lg:bg-brand-soft/60"
                        : "border-transparent font-medium text-gray-600 hover:bg-surface-container hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    <span className="flex min-w-0 flex-col">
                      <span>{t.label}</span>
                      <span className="hidden truncate text-[11px] font-normal text-gray-500 lg:block">{t.description}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <section key={active.id} aria-label={active.label} className="min-w-0 flex-1 animate-page-in">
          {tab === "profile" && <ProfilePanel />}
          {tab === "preferences" && <PreferencesPanel />}
          {tab === "notifications" && <NotificationsPanel />}
          {tab === "security" && <SecurityPanel />}
          {tab === "activity" && <ActivityPanel />}
        </section>
      </div>
    </div>
  );
}
