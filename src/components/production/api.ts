export type FieldErrors = Record<string, string[] | undefined>;

export async function readApi<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load production data (${response.status})`);
  return response.json() as Promise<T>;
}

// Never throws (network drop, HTML error page): the caller always gets a
// result and can clear its busy state.
export async function writeApi(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { ok: false as const, fieldErrors: {} as FieldErrors, error: "Couldn't reach the server. Check the connection and try again." };
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false as const,
      fieldErrors: (data?.fieldErrors ?? {}) as FieldErrors,
      error: (data?.error as string | undefined) ?? `Request failed (${response.status})`,
    };
  }
  return { ok: true as const, data };
}
