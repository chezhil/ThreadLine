"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Laptop, LogOut, Smartphone } from "lucide-react";
import { Button, Input, Pager } from "@/components/ui";
import { usePaged } from "@/lib/usePaged";
import { signOut } from "@/components/layout/sign-out";
import { firstError, postJson, useApi } from "@/lib/useApi";
import { dateTimeIN } from "@/lib/accounts/format";
import { passwordSchema } from "@/lib/validation/profile";
import { FormNote, Section } from "./controls";

interface SessionRow {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

/** "Chrome on Windows" from a User-Agent string; good enough to recognise a device. */
export function describeDevice(ua: string | null): { label: string; mobile: boolean } {
  if (!ua) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "an unknown system";
  return { label: `${browser} on ${os}`, mobile: /Android|iPhone|iPad|Mobile/.test(ua) };
}

/** 0–4: a rough, honest strength hint (length and variety), not a guarantee. */
function strength(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_BAR = ["bg-red-500", "bg-red-500", "bg-amber-500", "bg-emerald-500", "bg-emerald-600"];

export function SecurityPanel() {
  return (
    <div className="flex flex-col gap-4">
      <PasswordForm />
      <Sessions />
    </div>
  );
}

function PasswordForm() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setNote(null);
  };
  const score = strength(form.newPassword);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    const local: Record<string, string[]> = {};
    const parsed = passwordSchema.safeParse({ currentPassword: form.currentPassword, newPassword: form.newPassword });
    if (!parsed.success) for (const i of parsed.error.issues) (local[String(i.path[0])] ??= []).push(i.message);
    if (form.newPassword !== form.confirm) local.confirm = ["The two passwords don't match"];
    setErrors(local);
    if (Object.keys(local).length || !parsed.success) return;

    setBusy(true);
    const res = await postJson<{ signedOutElsewhere?: number }>("/api/me/password", parsed.data);
    setBusy(false);
    if (!res.ok) {
      const fields = res.fieldErrors ?? {};
      setErrors(fields);
      // Errors that belong to a field show under it; anything else (a rate
      // limit, a network failure) has no field, so it gets the banner.
      if (!["currentPassword", "newPassword"].some((k) => fields[k]?.length)) {
        setNote({ kind: "error", text: firstError(res, "Couldn't change your password.") });
      }
      return;
    }
    setForm({ currentPassword: "", newPassword: "", confirm: "" });
    const n = res.data.signedOutElsewhere ?? 0;
    setNote({ kind: "ok", text: `Password changed.${n ? ` ${n} other ${n === 1 ? "device was" : "devices were"} signed out.` : ""}` });
  }

  return (
    <Section title="Password" description="Use a password you don't use anywhere else. Changing it signs out your other devices.">
      <form onSubmit={submit} className="flex max-w-md flex-col gap-4 px-5 py-5" noValidate>
        <Input label="Current password" name="currentPassword" type="password" value={form.currentPassword} onChange={set("currentPassword")} error={errors.currentPassword?.[0]} autoComplete="current-password" />
        <div className="flex flex-col gap-1.5">
          <Input label="New password" name="newPassword" type="password" value={form.newPassword} onChange={set("newPassword")} error={errors.newPassword?.[0]} autoComplete="new-password" />
          {form.newPassword && (
            <div aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className={`h-1 flex-1 ${i < score ? STRENGTH_BAR[score] : "bg-surface-container"}`} />
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500">Strength: {STRENGTH_LABEL[score]}. At least 8 characters with a letter and a number.</p>
            </div>
          )}
        </div>
        <Input label="Confirm new password" name="confirm" type="password" value={form.confirm} onChange={set("confirm")} error={errors.confirm?.[0]} autoComplete="new-password" />
        {note && <FormNote kind={note.kind}>{note.text}</FormNote>}
        <div>
          <Button type="submit" disabled={busy || !form.currentPassword || !form.newPassword}>
            {busy ? "Changing…" : "Change password"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function Sessions() {
  const router = useRouter();
  const { data, error, refetch } = useApi<{ sessions: SessionRow[] }>("/api/me/sessions");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function revoke(id?: string) {
    setBusy(id ?? "all");
    setNote(null);
    const res = await postJson<{ revoked?: number }>("/api/me/sessions", id ? { id } : {}, "DELETE");
    setBusy(null);
    if (!res.ok) {
      setNote(firstError(res, "Couldn't sign that device out."));
      return;
    }
    refetch();
  }

  const rows = data?.sessions ?? [];
  const others = rows.filter((s) => !s.current);
  const paged = usePaged(rows, 10);

  return (
    <Section title="Where you're signed in" description="Sessions last 7 days. Sign out any device you don't recognise.">
      {error && <p className="px-5 py-4 text-[13px] text-red-700">Couldn&apos;t load your sessions. {error}</p>}
      {!data && !error && <p className="px-5 py-4 text-[13px] text-gray-500">Loading…</p>}
      {paged.pageRows.map((s) => {
        const d = describeDevice(s.userAgent);
        const Icon = d.mobile ? Smartphone : Laptop;
        return (
          <div key={s.id} className="flex items-center gap-3 px-5 py-3.5">
            <Icon className="h-5 w-5 shrink-0 text-gray-500" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-foreground">
                {d.label}
                {s.current && <span className="label-caps-sm border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-emerald-800">This device</span>}
              </p>
              <p className="text-xs text-gray-500">Signed in {dateTimeIN(s.createdAt)} · expires {dateTimeIN(s.expiresAt)}</p>
            </div>
            {!s.current && (
              <Button variant="secondary" size="sm" disabled={busy !== null} onClick={() => revoke(s.id)}>
                {busy === s.id ? "Signing out…" : "Sign out"}
              </Button>
            )}
          </div>
        );
      })}
      {paged.showPager && (
        <div className="px-5 py-3">
          <Pager {...paged.pagerProps} />
        </div>
      )}
      {note && (
        <div className="px-5 py-3">
          <FormNote kind="error">{note}</FormNote>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Button variant="secondary" size="sm" disabled={!others.length || busy !== null} onClick={() => revoke()}>
          {busy === "all" ? "Signing out…" : `Sign out ${others.length > 1 ? `${others.length} other devices` : "other devices"}`}
        </Button>
        <Button variant="danger" size="sm" onClick={() => void signOut(router)}>
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
          Sign out of this device
        </Button>
      </div>
    </Section>
  );
}
