import { ollamaVision } from "@/lib/assistant/ollama";
import { getImportTarget } from "./targets";

/** Pull the first JSON array out of a model response, tolerating ```json fences and stray prose. */
function extractJsonArray(text: string): unknown[] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("The model's response didn't contain a JSON array.");
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of rows.");
  return parsed;
}

export async function extractRowsFromImage(
  targetKey: string,
  imageBase64: string,
): Promise<{ rows: Record<string, string>[]; raw: string }> {
  const target = getImportTarget(targetKey);
  if (!target) throw new Error(`Unknown import target "${targetKey}"`);

  const fieldList = target.fields
    .map((f) => `- "${f.key}": ${f.label}${f.required ? " (required)" : " (optional, omit if not legible)"} — e.g. "${f.example}"`)
    .join("\n");

  const prompt = `You are reading a photo of a handwritten ${target.label} from an Indian textile mill.
Transcribe every row of the register into a JSON array. Each array element is one object with exactly these keys:
${fieldList}

Rules:
- Output ONLY a JSON array, nothing else — no prose, no markdown fences.
- One object per row of the register. Skip header rows and totals rows.
- If a cell is illegible or blank, use an empty string "" for that field rather than guessing.
- Keep dates as they're written (e.g. "12/10/2026" or "12-10-26") — don't convert them yourself.
- Keep numbers as plain digits, no currency symbols or thousands separators.`;

  const raw = await ollamaVision(
    [{ role: "user", content: prompt, images: [imageBase64] }],
    { json: false },
  );

  const parsed = extractJsonArray(raw);
  const rows: Record<string, string>[] = parsed.map((entry) => {
    const obj: Record<string, string> = {};
    if (entry && typeof entry === "object") {
      for (const field of target.fields) {
        const v = (entry as Record<string, unknown>)[field.key];
        obj[field.key] = v === undefined || v === null ? "" : String(v);
      }
    }
    return obj;
  });

  return { rows, raw };
}
