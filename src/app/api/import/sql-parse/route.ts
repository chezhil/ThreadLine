import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { parseSqlDump } from "@/lib/import/sql-parser";

const schema = z.object({
  sql: z.string().trim().min(1, "Paste or upload a .sql file first").max(2_000_000, "That file is too large"),
});

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const result = parseSqlDump(parsed.data.sql);
  const ROW_CAP = 5000; // the client holds the full set in memory to map/commit
  const warnings = [...result.warnings];
  const tables = result.tables.map((t) => {
    if (t.rows.length > ROW_CAP) {
      warnings.push(`"${t.name}" has ${t.rows.length} rows — only the first ${ROW_CAP} were returned. Split the file and import the rest separately.`);
    }
    return {
      name: t.name,
      columns: t.columns,
      rowCount: t.rows.length,
      rows: t.rows.slice(0, ROW_CAP),
    };
  });

  return NextResponse.json({ tables, warnings });
}
