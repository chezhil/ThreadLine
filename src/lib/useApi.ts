"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
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

  return { data, loading, error, refetch };
}

/** Never throws: a network failure or a non-JSON reply (an HTML error
 * page, an empty 502) comes back as ok: false with an error message, so the
 * caller's "saving…" state is always cleared. */
export async function postJson<T = unknown>(
  url: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<{ ok: boolean; data: T; fieldErrors?: Record<string, string[]>; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    const error = "Couldn't reach the server. Check the connection and try again.";
    return { ok: false, data: { error } as T, fieldErrors: { form: [error] }, error };
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; fieldErrors?: Record<string, string[]> }) | null;
  const error = res.ok ? undefined : (data?.error ?? `Request failed (${res.status})`);
  const fieldErrors = data?.fieldErrors ?? (res.ok ? undefined : { form: [error!] });
  return { ok: res.ok, data: (data ?? ({ error } as T)) as T, fieldErrors, error };
}
