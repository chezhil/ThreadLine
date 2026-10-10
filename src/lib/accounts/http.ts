import { NextResponse } from "next/server";
import type { ZodError } from "zod";

// Small response helpers shared by the Module 4 API routes so every write
// endpoint returns the contract's `{ fieldErrors }` shape the same way.

export function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function notFound(what = "Not found") {
  return NextResponse.json({ error: what }, { status: 404 });
}

export function fieldErrorResponse(fieldErrors: Record<string, string[]>, status = 400) {
  return NextResponse.json({ fieldErrors }, { status });
}

/**
 * Flattens a zod error into `{ "path.to.field": [messages] }`. Unlike
 * `error.flatten()` this keeps nested paths (e.g. `entries.3.machineId`) so a
 * multi-row form can show the error on the right row.
 */
export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
