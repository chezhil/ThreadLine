import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { fieldErrorResponse, forbidden, readJson, zodFieldErrors } from "@/lib/accounts/http";
import { extractRowsFromImage } from "@/lib/import/ocr";
import { getImportTarget } from "@/lib/import/targets";
import { OllamaUnavailableError, OLLAMA_VISION_MODEL } from "@/lib/assistant/ollama";

const schema = z.object({
  target: z.string().trim().min(1, "Pick what kind of register this is"),
  // data: URL ("data:image/jpeg;base64,...") or bare base64 — we accept either.
  imageBase64: z.string().trim().min(100, "No image data received"),
});

export async function POST(req: NextRequest) {
  const user = await requireRole("owner");
  if (!user) return forbidden();

  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return fieldErrorResponse(zodFieldErrors(parsed.error));

  const target = getImportTarget(parsed.data.target);
  if (!target) return fieldErrorResponse({ target: ["Unknown import target"] });

  const imageBase64 = parsed.data.imageBase64.replace(/^data:image\/\w+;base64,/, "");

  try {
    const { rows, raw } = await extractRowsFromImage(parsed.data.target, imageBase64);
    return NextResponse.json({ rows, modelRaw: raw });
  } catch (e) {
    if (e instanceof OllamaUnavailableError) {
      return NextResponse.json(
        { error: `${e.message} (Scanning a note needs the vision model "${OLLAMA_VISION_MODEL}" specifically — the text assistant's model won't read images.)` },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read that image." },
      { status: 422 },
    );
  }
}
