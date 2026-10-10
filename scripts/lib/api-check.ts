// Shared by the API verification scripts: PASS/FAIL bookkeeping and a
// cookie-carrying JSON client for a running server (BASE, default
// http://localhost:3000).

export const BASE = process.env.BASE ?? "http://localhost:3000";

let passes = 0;
let failures = 0;

export function check(name: string, cond: unknown, detail?: unknown) {
  if (cond) {
    passes++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail !== undefined ? `\n      ${JSON.stringify(detail).slice(0, 600)}` : ""}`);
  }
}

/** Prints the tally and sets a failing exit code if anything failed. */
export function report() {
  console.log(`\n${passes} passed, ${failures} failed`);
  if (failures) process.exitCode = 1;
}

export async function login(name: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, password }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!res.ok || !cookie) throw new Error(`login as ${name} failed (${res.status})`);
  return cookie;
}

/** The error shapes every route answers with. */
export interface ApiError {
  error?: string;
  fieldErrors?: Record<string, string[] | string>;
}

export interface ApiResponse<T> {
  status: number;
  /** Parsed body (null for a non-JSON reply), typed as the caller expects. */
  json: (T & ApiError) | null;
  text: string;
  headers: Headers;
}

export type Client = <T = unknown>(method: string, path: string, body?: unknown) => Promise<ApiResponse<T>>;

/** A client for one session cookie (null = signed out). A string body is
 * sent as-is, for malformed-JSON checks. */
export function client(cookie: string | null): Client {
  return async <T>(method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json: (T & ApiError) | null = null;
    try {
      json = JSON.parse(text) as T & ApiError;
    } catch {
      /* CSV, HTML or empty */
    }
    return { status: res.status, json, text, headers: res.headers };
  };
}

/** First message of an error reply, for readable failure output. */
export function firstError(json: ApiError | null): string {
  if (!json) return "";
  const field = Object.values(json.fieldErrors ?? {})[0];
  return (Array.isArray(field) ? field[0] : field) ?? json.error ?? "";
}

export const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export const uniq = (prefix: string) => `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
