export type FieldErrors = Record<string, string[] | undefined>;

export async function readApi<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load production data (${response.status})`);
  return response.json() as Promise<T>;
}

export async function writeApi(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  const response = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) return { ok: false as const, fieldErrors: (data.fieldErrors ?? {}) as FieldErrors, error: data.error as string | undefined };
  return { ok: true as const, data };
}
