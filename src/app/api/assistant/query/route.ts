import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { askAssistant } from "@/lib/assistant/engine";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { assistantQuerySchema } from "@/lib/validation/accounts";

// POST { question } → { answer, tool, args, data, mode, verified, notice? }
// The model only ever chooses among the read-only tools in lib/assistant/tools.ts.
export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = assistantQuerySchema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  try {
    return NextResponse.json(await askAssistant(parsed.data.question));
  } catch (e) {
    console.error("[assistant] query failed", e);
    return NextResponse.json({ error: "The assistant couldn't run that query. Nothing was guessed." }, { status: 500 });
  }
}
