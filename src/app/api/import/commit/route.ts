import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { getImportTarget } from "@/lib/import/targets";

const schema = z.object({
  target: z.string().trim().min(1),
  rows: z.array(z.record(z.string(), z.string())).min(1, "No rows to import").max(5000, "Import in smaller batches"),
});

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const target = getImportTarget(parsed.data.target);
  if (!target) return fieldErrorResponse({ target: ["Unknown import target"] });

  // Sequential, not Promise.all: rows commonly share a supplier/buyer/worker
  // that gets created on row 1 and reused by row 2 — concurrent creates would
  // race and produce duplicates.
  const results: { index: number; ok: boolean; message: string }[] = [];
  for (let i = 0; i < parsed.data.rows.length; i++) {
    try {
      const result = await target.commitRow(parsed.data.rows[i], user.id);
      results.push({ index: i, ok: result.ok, message: result.summary });
    } catch (e) {
      results.push({ index: i, ok: false, message: e instanceof Error ? e.message : "Import failed" });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return NextResponse.json({ results, succeeded, failed: results.length - succeeded }, { status: 201 });
}
