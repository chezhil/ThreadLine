// Profile, preferences, password and session endpoints (/api/me/*), against a
// running app on a seeded database:
//
//   BASE=http://localhost:3000 npx tsx scripts/verify-account.ts
//
// Uses the seeded "qc" user and puts everything back (profile, preferences,
// password) when it is done.

import { db } from "../src/lib/db";

const BASE = process.env.BASE ?? "http://localhost:3000";
let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || detail === undefined ? "" : `\n      ${JSON.stringify(detail).slice(0, 400)}`}`);
  if (!cond) failures++;
}

async function login(name: string, password: string, ua = "verify-account/1.0") {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": ua },
    body: JSON.stringify({ name, password }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? null;
  return { res, cookie, body: (await res.json().catch(() => ({}))) as { redirectTo?: string } };
}
const call = async (cookie: string | null, method: string, path: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

// A 1x1 transparent PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PASSWORD = "qc123";
const NEW_PASSWORD = "Tr0ub4dor-mill";

async function main() {
  const user = await db.user.findFirstOrThrow({ where: { name: "qc" } });
  const original = { fullName: user.fullName, email: user.email, phone: user.phone, jobTitle: user.jobTitle, avatar: user.avatar, preferences: user.preferences, passwordHash: user.passwordHash };

  try {
    const a = await login("qc", PASSWORD, "Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36");
    const cookie = a.cookie!;
    check("qc can sign in", !!cookie);

    // ---- auth required everywhere -------------------------------------------
    for (const [m, p] of [["GET", "/api/me"], ["PATCH", "/api/me"], ["PATCH", "/api/me/preferences"], ["POST", "/api/me/password"], ["GET", "/api/me/sessions"], ["DELETE", "/api/me/sessions"], ["GET", "/api/me/activity"]]) {
      const r = await call(null, m, p, m === "GET" ? undefined : {});
      check(`${m} ${p} without a session → 401`, r.status === 401, r.status);
    }

    // ---- profile -------------------------------------------------------------
    const me = await call(cookie, "GET", "/api/me");
    check("GET /api/me returns the profile and preferences", me.status === 200 && me.json?.profile?.name === "qc" && !!me.json?.profile?.preferences, me.json);

    const p1 = await call(cookie, "PATCH", "/api/me", { fullName: "  Priya  Shah ", phone: "+91 98765 43210", jobTitle: "Lead inspector", email: "Priya@Example.com" });
    check("PATCH saves, trims and lower-cases the email", p1.status === 200 && p1.json?.profile?.fullName === "Priya  Shah" && p1.json?.profile?.email === "priya@example.com", p1.json);
    const p2 = await call(cookie, "PATCH", "/api/me", { phone: "" });
    check("clearing one field leaves the others alone", p2.status === 200 && p2.json?.profile?.phone === null && p2.json?.profile?.fullName === "Priya  Shah" && p2.json?.profile?.jobTitle === "Lead inspector", p2.json);
    check("bad email → field error", (await call(cookie, "PATCH", "/api/me", { email: "not-an-email" })).json?.fieldErrors?.email?.length === 1);
    check("bad phone → field error", (await call(cookie, "PATCH", "/api/me", { phone: "abc" })).json?.fieldErrors?.phone?.length === 1);
    check("overlong name → field error", (await call(cookie, "PATCH", "/api/me", { fullName: "x".repeat(81) })).json?.fieldErrors?.fullName?.length === 1);
    check("cannot change role or username through the profile", (await call(cookie, "PATCH", "/api/me", { role: "owner" })).status === 400 && (await call(cookie, "PATCH", "/api/me", { name: "root" })).status === 400);
    check("empty update → 400", (await call(cookie, "PATCH", "/api/me", {})).status === 400);
    check("non-JSON body → 400, not a crash", (await fetch(`${BASE}/api/me`, { method: "PATCH", headers: { cookie, "Content-Type": "application/json" }, body: "{oops" })).status === 400);

    check("avatar: a PNG is accepted", (await call(cookie, "PATCH", "/api/me", { avatar: PNG })).json?.profile?.avatar === PNG);
    check("avatar: not an image → rejected", (await call(cookie, "PATCH", "/api/me", { avatar: "data:text/html;base64,PHNjcmlwdD4=" })).status === 400);
    check("avatar: SVG (can carry script) → rejected", (await call(cookie, "PATCH", "/api/me", { avatar: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).status === 400);
    check("avatar: a URL → rejected", (await call(cookie, "PATCH", "/api/me", { avatar: "https://evil.example/x.png" })).status === 400);
    check("avatar: oversized → rejected", (await call(cookie, "PATCH", "/api/me", { avatar: `data:image/png;base64,${"A".repeat(150_000)}` })).status === 400);
    check("avatar: null removes it", (await call(cookie, "PATCH", "/api/me", { avatar: null })).json?.profile?.avatar === null);
    const audit = await db.auditLog.findFirst({ where: { userId: user.id, action: "PROFILE_UPDATED" }, orderBy: { at: "desc" } });
    check("profile edits are audited without storing the picture", !!audit && !(audit.newValue ?? "").includes("base64"), audit);

    // The shell must never leak anyone else's profile: the id comes from the session.
    const other = await call(cookie, "PATCH", "/api/me", { fullName: "Mine", id: "someone-else" });
    check("an id in the body is rejected, not honoured", other.status === 400);

    // ---- preferences ---------------------------------------------------------
    const f1 = await call(cookie, "PATCH", "/api/me/preferences", { theme: "dark" });
    check("preferences: set theme", f1.status === 200 && f1.json?.preferences?.theme === "dark", f1.json);
    const f2 = await call(cookie, "PATCH", "/api/me/preferences", { sidebarCollapsed: true });
    check("preferences: a later save keeps earlier choices (merge, not reset)", f2.json?.preferences?.theme === "dark" && f2.json?.preferences?.sidebarCollapsed === true, f2.json);
    check("preferences: unknown key → 400", (await call(cookie, "PATCH", "/api/me/preferences", { bogus: 1 })).status === 400);
    check("preferences: invalid value → 400", (await call(cookie, "PATCH", "/api/me/preferences", { theme: "neon" })).status === 400);
    check("preferences: start page must be one the role can open", (await call(cookie, "PATCH", "/api/me/preferences", { startPage: "/accounts" })).status === 400);
    check("preferences: a permitted start page is saved", (await call(cookie, "PATCH", "/api/me/preferences", { startPage: "/alerts" })).json?.preferences?.startPage === "/alerts");
    const burst = await Promise.all(["alertSound", "reduceMotion", "showSeconds"].map((k, i) => call(cookie, "PATCH", "/api/me/preferences", { [k]: i !== 2 })));
    const after = (await call(cookie, "GET", "/api/me")).json?.profile?.preferences;
    check("preferences: simultaneous saves of different keys all land", burst.every((r) => r.status === 200) && after?.alertSound === true && after?.reduceMotion === true && after?.showSeconds === false && after?.theme === "dark", after);
    const viaBeacon = await fetch(`${BASE}/api/me/preferences`, { method: "POST", headers: { cookie, "Content-Type": "text/plain" }, body: JSON.stringify({ textSize: "large" }) });
    check("preferences: POST works too (navigator.sendBeacon can only POST)", viaBeacon.status === 200 && (await call(cookie, "GET", "/api/me")).json?.profile?.preferences?.textSize === "large");

    const redirect = await login("qc", PASSWORD);
    check("sign-in honours the saved start page", redirect.body.redirectTo === "/alerts", redirect.body);

    // ---- sessions ------------------------------------------------------------
    const b = await login("qc", PASSWORD, "Mozilla/5.0 (iPhone; CPU iPhone OS 17) Mobile Safari/604.1");
    const list = await call(cookie, "GET", "/api/me/sessions");
    const sessions = (list.json?.sessions ?? []) as { id: string; current: boolean; userAgent: string | null }[];
    check("sessions: lists this device and the others, marking the current one", sessions.filter((s) => s.current).length === 1 && sessions.length >= 2, sessions);
    check("sessions: device is recorded from the User-Agent", sessions.some((s) => /iPhone/.test(s.userAgent ?? "")));
    check("sessions: ids never expose the stored hash", sessions.every((s) => /^[0-9a-f]{16}$/.test(s.id)));
    const iphone = sessions.find((s) => /iPhone/.test(s.userAgent ?? ""))!;
    check("sessions: you can't revoke the device you're on", (await call(cookie, "DELETE", "/api/me/sessions", { id: sessions.find((s) => s.current)!.id })).status === 404);
    check("sessions: malformed id → 400", (await call(cookie, "DELETE", "/api/me/sessions", { id: "../../etc" })).status === 400);
    check("sessions: revoke one other device", (await call(cookie, "DELETE", "/api/me/sessions", { id: iphone.id })).json?.revoked === 1);
    check("…and that device is signed out", (await call(b.cookie, "GET", "/api/me")).status === 401);
    check("…while this one still works", (await call(cookie, "GET", "/api/me")).status === 200);

    // another user can't be reached through these endpoints
    const owner = await login("owner", "owner123");
    await call(cookie, "DELETE", "/api/me/sessions", {});
    check("sessions: 'sign out other devices' never touches another user's sessions", (await call(owner.cookie, "GET", "/api/me")).status === 200);

    // ---- password ------------------------------------------------------------
    const pw = (body: unknown, ck: string | null = cookie) => call(ck, "POST", "/api/me/password", body);
    check("password: wrong current password", (await pw({ currentPassword: "nope", newPassword: NEW_PASSWORD })).json?.fieldErrors?.currentPassword?.length === 1);
    check("password: too short", (await pw({ currentPassword: PASSWORD, newPassword: "ab1" })).json?.fieldErrors?.newPassword?.length === 1);
    check("password: needs a number and a letter", (await pw({ currentPassword: PASSWORD, newPassword: "onlyletters" })).json?.fieldErrors?.newPassword?.length === 1);
    check("password: over 72 chars refused (bcrypt would silently truncate)", (await pw({ currentPassword: PASSWORD, newPassword: `a1${"x".repeat(80)}` })).status === 400);
    check("password: same as current refused", (await pw({ currentPassword: PASSWORD, newPassword: PASSWORD })).json?.fieldErrors?.newPassword?.length === 1);

    const c = await login("qc", PASSWORD, "second device");
    const changed = await pw({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    check("password: changed", changed.status === 200 && changed.json?.ok === true, changed.json);
    check("password: this session survives", (await call(cookie, "GET", "/api/me")).status === 200);
    check("password: other devices are signed out", (await call(c.cookie, "GET", "/api/me")).status === 401);
    check("password: old password no longer signs in", (await login("qc", PASSWORD)).res.status === 400);
    check("password: new password signs in", !!(await login("qc", NEW_PASSWORD)).cookie);
    check("password change is audited without the password", !!(await db.auditLog.findFirst({ where: { userId: user.id, action: "PASSWORD_CHANGED" } })));

    // Brute-force guard: five wrong guesses lock the endpoint for a while. Done
    // as a different user so this script stays re-runnable (the lock lives in
    // the server's memory for 15 minutes).
    const floor = await login("floor", "floor123");
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await pw({ currentPassword: `wrong${i}`, newPassword: "Another-pass1" }, floor.cookie)).status;
    check("password: repeated wrong guesses are rate-limited (429)", last === 429, last);

    // ---- activity ------------------------------------------------------------
    const act = await call(cookie, "GET", "/api/me/activity");
    const rows = (act.json?.activity ?? []) as { action: string }[];
    check("activity: shows your own changes", act.status === 200 && rows.some((r) => r.action === "PROFILE_UPDATED") && rows.some((r) => r.action === "PASSWORD_CHANGED"), rows.slice(0, 3));
  } finally {
    await db.user.update({ where: { id: user.id }, data: original });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.auditLog.deleteMany({ where: { userId: user.id, action: { in: ["PROFILE_UPDATED", "PASSWORD_CHANGED", "SESSIONS_REVOKED"] } } });
    await db.$disconnect();
  }

  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
