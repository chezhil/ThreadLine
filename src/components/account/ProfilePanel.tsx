"use client";
import { useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { Avatar } from "@/components/layout/Avatar";
import { displayName, useShell } from "@/components/layout/ShellProvider";
import { ROLE_LABEL } from "@/components/layout/nav-config";
import { postJson } from "@/lib/useApi";
import { profileSchema } from "@/lib/validation/profile";
import { dateTimeIN, dateIN } from "@/lib/accounts/format";
import { FormNote, PLAIN_CARD, Section, Tilt } from "./controls";

const AVATAR_SIZE = 256;

/** Centre-crops and shrinks a chosen image to a small JPEG data URL. */
async function resizeToAvatar(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|bmp)$/.test(file.type)) throw new Error("Choose a JPEG, PNG or WebP image.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That image is over 10 MB.");
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That image couldn't be read. Try a different one.");
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images.");
  ctx.fillStyle = "#ffffff"; // flatten transparency, JPEG has none
  ctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

export function ProfilePanel() {
  const { user, setUser } = useShell();
  const [form, setForm] = useState({
    fullName: user.fullName ?? "",
    jobTitle: user.jobTitle ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    form.fullName.trim() !== (user.fullName ?? "") ||
    form.jobTitle.trim() !== (user.jobTitle ?? "") ||
    form.email.trim().toLowerCase() !== (user.email ?? "") ||
    form.phone.trim() !== (user.phone ?? "");

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setNote(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setNote(null);
    // Same rules as the server, so mistakes are caught without a round trip.
    const parsed = profileSchema.safeParse(form);
    if (!parsed.success) {
      const out: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (out[String(issue.path[0] ?? "_form")] ??= []).push(issue.message);
      setErrors(out);
      return;
    }
    setErrors({});
    setBusy(true);
    const res = await postJson<{ profile?: typeof user }>("/api/me", parsed.data, "PATCH");
    setBusy(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      setNote({ kind: "error", text: res.fieldErrors?._form?.[0] ?? res.error ?? "Couldn't save your profile." });
      return;
    }
    const p = res.data.profile;
    if (p) setUser({ fullName: p.fullName, jobTitle: p.jobTitle, email: p.email, phone: p.phone });
    setNote({ kind: "ok", text: "Profile saved." });
  }

  async function savePhoto(avatar: string | null) {
    setPhotoBusy(true);
    setNote(null);
    const res = await postJson("/api/me", { avatar }, "PATCH");
    setPhotoBusy(false);
    if (!res.ok) {
      setNote({ kind: "error", text: res.fieldErrors?.avatar?.[0] ?? res.error ?? "Couldn't update your photo." });
      return;
    }
    setUser({ avatar });
    setNote({ kind: "ok", text: avatar ? "Photo updated." : "Photo removed." });
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again
    if (!file) return;
    try {
      setPhotoBusy(true);
      await savePhoto(await resizeToAvatar(file));
    } catch (err) {
      setPhotoBusy(false);
      setNote({ kind: "error", text: err instanceof Error ? err.message : "Couldn't use that image." });
    }
  }

  const name = displayName(user);
  const role = ROLE_LABEL[user.role];

  return (
    <div className="flex flex-col gap-4">
      <Tilt max={3}>
        <div className={`relative overflow-hidden ${PLAIN_CARD}`}>
          <div
            className="h-24 bg-brand"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgb(255 255 255 / 0.07) 0 1px, transparent 1px 18px), repeating-linear-gradient(0deg, rgb(255 255 255 / 0.07) 0 1px, transparent 1px 18px)",
            }}
            aria-hidden="true"
          />
          <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
            <div className="-mt-12 flex items-end gap-4">
              <div className="relative">
                <Avatar name={name} src={user.avatar} className="h-24 w-24 border-4 border-surface text-3xl shadow-md" />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={photoBusy}
                  aria-label="Change profile photo"
                  className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-brand text-white shadow transition-colors hover:bg-brand-container disabled:opacity-60"
                >
                  <Camera className="h-4 w-4" aria-hidden="true" />
                </button>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onPick} aria-label="Choose profile photo" tabIndex={-1} />
              </div>
            </div>
            <div className="min-w-0 flex-1 sm:pb-1">
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{name}</h2>
              <p className="truncate text-[13px] text-gray-500">
                {user.jobTitle ? `${user.jobTitle} · ` : ""}@{user.name}
              </p>
              <span className="label-caps-sm mt-1.5 inline-block bg-brand-soft px-1.5 py-0.5 text-brand">{role.title}</span>
            </div>
            <div className="flex gap-2 sm:pb-1">
              <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
                <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                {photoBusy ? "Working…" : user.avatar ? "Change photo" : "Upload photo"}
              </Button>
              {user.avatar && (
                <Button type="button" variant="ghost" size="sm" onClick={() => savePhoto(null)} disabled={photoBusy}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </Tilt>

      {note && <FormNote kind={note.kind}>{note.text}</FormNote>}

      <Section title="Personal details" description="Shown on your account and in the menu. Your sign-in username can't be changed here.">
        <form onSubmit={save} className="flex flex-col gap-4 px-5 py-5" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" name="fullName" value={form.fullName} onChange={set("fullName")} error={errors.fullName?.[0]} autoComplete="name" maxLength={80} placeholder="e.g. Rajesh Patel" />
            <Input label="Job title" name="jobTitle" value={form.jobTitle} onChange={set("jobTitle")} error={errors.jobTitle?.[0]} maxLength={60} placeholder="e.g. Managing director" />
            <Input label="Email" name="email" type="email" value={form.email} onChange={set("email")} error={errors.email?.[0]} autoComplete="email" maxLength={120} placeholder="you@company.com" />
            <Input label="Phone" name="phone" type="tel" value={form.phone} onChange={set("phone")} error={errors.phone?.[0]} autoComplete="tel" maxLength={24} placeholder="+91 98765 43210" />
            <Input label="Username" name="username" value={user.name} disabled readOnly />
            <Input label="Role" name="role" value={role.title} disabled readOnly />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">Role is set by the mill owner and can&apos;t be edited here.</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={!dirty || busy}
                onClick={() => {
                  setForm({ fullName: user.fullName ?? "", jobTitle: user.jobTitle ?? "", email: user.email ?? "", phone: user.phone ?? "" });
                  setErrors({});
                  setNote(null);
                }}
              >
                Reset
              </Button>
              <Button type="submit" disabled={!dirty || busy}>
                {busy ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </Section>

      <Section title="Account">
        <dl className="grid gap-x-6 gap-y-3 px-5 py-4 text-[13px] sm:grid-cols-3">
          <div>
            <dt className="label-caps-sm text-gray-500">Member since</dt>
            <dd className="mt-0.5 font-medium text-foreground">{dateIN(user.createdAt)}</dd>
          </div>
          <div>
            <dt className="label-caps-sm text-gray-500">Last sign-in</dt>
            <dd className="mt-0.5 font-medium text-foreground">{user.lastLoginAt ? dateTimeIN(user.lastLoginAt) : "—"}</dd>
          </div>
          <div>
            <dt className="label-caps-sm text-gray-500">Account ID</dt>
            <dd className="mt-0.5 truncate font-mono text-xs text-gray-600" title={user.id}>
              {user.id.slice(0, 8)}…
            </dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}
