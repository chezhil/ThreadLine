"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** A null url skips the request (for data the current user can't open). */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState<string | null>(null);
  // HTTP status of the last failed load (404 vs 403 vs 500), null otherwise.
  const [status, setStatus] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (url === null) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setStatus(null);
      try {
        const res = await fetch(url!);
        if (!res.ok) {
          if (!cancelled) setStatus(res.status);
          throw new Error(`Request failed (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [url, version]);

  const refetch = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  return { data, loading, error, status, refetch };
}

/** Never throws: a network failure or a non-JSON reply (an HTML error
 * page, an empty 502) comes back as ok: false with an error message, so the
 * caller's "saving…" state is always cleared. A failure without field errors
 * is reported under `_form`, the key the API uses for whole-form errors. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): Promise<{ ok: boolean; data: T; fieldErrors?: Record<string, string[]>; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const error = "Couldn't reach the server. Check the connection and try again.";
    return { ok: false, data: { error } as T, fieldErrors: { _form: [error] }, error };
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; fieldErrors?: Record<string, string[]> }) | null;
  const error = res.ok ? undefined : (data?.error ?? `Request failed (${res.status})`);
  const fieldErrors = data?.fieldErrors ?? (res.ok ? undefined : { _form: [error!] });
  return { ok: res.ok, data: (data ?? ({ error } as T)) as T, fieldErrors, error };
}

/** The first message of a failed postJson, for one-line error banners. */
export function firstError(res: { fieldErrors?: Record<string, string[]>; error?: string }, fallback: string): string {
  return Object.values(res.fieldErrors ?? {}).flat()[0] ?? res.error ?? fallback;
}
