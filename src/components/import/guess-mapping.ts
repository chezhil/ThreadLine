import type { ImportFieldDef } from "./types";

// Common shorthand seen in small-business SQL dumps and spreadsheet exports,
// expanded before tokenising so "qty_kg" and "Quantity received (kg)" share
// enough words to match.
const SYNONYMS: Record<string, string> = {
  qty: "quantity",
  amt: "amount",
  dt: "date",
  no: "number",
  recv: "received",
  rcvd: "received",
};

function tokenize(s: string): string[] {
  const words = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => SYNONYMS[w] ?? w);
  return words.filter((w) => w.length > 1 && !["the", "a", "an", "of", "on", "in"].includes(w));
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-effort default column→field mapping so the person edits instead of starting blank. */
export function guessMapping(fields: ImportFieldDef[], columns: string[]): Record<string, string> {
  const cols = columns.map((c) => ({ raw: c, norm: normalize(c), tokens: new Set(tokenize(c)) }));
  const mapping: Record<string, string> = {};
  const used = new Set<string>();

  for (const field of fields) {
    const exact = [normalize(field.key), normalize(field.label)];
    const fieldTokens = new Set([...tokenize(field.key), ...tokenize(field.label)]);

    let best: string | undefined;

    // 1. Exact match on the raw (normalized) name — "colour" === "colour".
    for (const col of cols) {
      if (used.has(col.raw)) continue;
      if (exact.includes(col.norm)) {
        best = col.raw;
        break;
      }
    }

    // 2. Best token overlap — "Quantity received (kg)" vs "qty_kg" both
    // reduce to {quantity, kg} after the qty→quantity synonym, score 2.
    if (!best) {
      let bestScore = 0;
      for (const col of cols) {
        if (used.has(col.raw) || col.tokens.size === 0) continue;
        let score = 0;
        for (const t of col.tokens) if (fieldTokens.has(t)) score++;
        // Require full agreement on the shorter side, so "name" alone
        // doesn't weakly match everything with "name" in it.
        const minSize = Math.min(col.tokens.size, fieldTokens.size);
        if (score > 0 && score === minSize && score > bestScore) {
          bestScore = score;
          best = col.raw;
        }
      }
    }

    if (best) {
      mapping[field.key] = best;
      used.add(best);
    }
  }
  return mapping;
}
