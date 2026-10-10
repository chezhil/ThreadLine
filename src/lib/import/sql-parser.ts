// A small, deliberately non-general SQL parser for the "Data Import" feature.
// It is NOT a full SQL grammar — it only understands the shape of a typical
// small-business export: CREATE TABLE statements (for column names) and
// INSERT INTO ... VALUES (...), (...), ...; statements (for rows). Anything
// fancier (subqueries, functions, multi-statement triggers) is ignored rather
// than mis-parsed. The parsed output is reviewed and edited by a person
// before anything is written to the database — this never writes directly.

export type SqlValue = string | number | boolean | null;

export interface ParsedTable {
  name: string;
  columns: string[];
  rows: Record<string, SqlValue>[];
}

export interface SqlParseResult {
  tables: ParsedTable[];
  warnings: string[];
}

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Split on `;` that isn't inside a quoted string. */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      current += ch;
      if (ch === quote && sql[i - 1] !== "\\") {
        // doubled quote inside a quoted string ('' ) stays in the same string
        if (sql[i + 1] === quote) {
          current += sql[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      statements.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter(Boolean);
}

/** Split a comma-separated list at the top level only (ignores commas inside (), '', ""). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") {
        if (text[i + 1] === quote) {
          current += text[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function stripIdentifierQuotes(name: string): string {
  return name.trim().replace(/^[`"[]|[`"\]]$/g, "");
}

function parseValue(raw: string): SqlValue {
  const v = raw.trim();
  if (/^null$/i.test(v)) return null;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
    const quote = v[0];
    const inner = v.slice(1, -1);
    return inner.replace(new RegExp(`\\\\${quote}|${quote}${quote}`, "g"), quote);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v; // unquoted token (rare in "simple" dumps) — keep as-is
}

function parseCreateTable(stmt: string): { name: string; columns: string[] } | null {
  const match = stmt.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"[\]\w.]+)\s*\(([\s\S]+)\)\s*(?:ENGINE|;)?.*$/i);
  if (!match) return null;
  const name = stripIdentifierQuotes(match[1].split(".").pop() ?? match[1]);
  const body = splitTopLevel(match[2]);
  const columns: string[] = [];
  for (const line of body) {
    const upper = line.trim().toUpperCase();
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|KEY|CONSTRAINT|INDEX|CHECK)\b/.test(upper)) continue;
    const colMatch = line.trim().match(/^([`"[\]\w]+)/);
    if (colMatch) columns.push(stripIdentifierQuotes(colMatch[1]));
  }
  return { name, columns };
}

function parseInsert(stmt: string): { table: string; columns: string[] | null; rows: SqlValue[][] } | null {
  const header = stmt.match(
    /^INSERT\s+(?:IGNORE\s+)?INTO\s+([`"[\]\w.]+)\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]+)$/i,
  );
  if (!header) return null;
  const table = stripIdentifierQuotes(header[1].split(".").pop() ?? header[1]);
  const columns = header[2] ? splitTopLevel(header[2]).map(stripIdentifierQuotes) : null;
  const valuesText = header[3];

  const rows: SqlValue[][] = [];
  let depth = 0;
  let current = "";
  let quote: "'" | '"' | null = null;
  let inTuple = false;
  for (let i = 0; i < valuesText.length; i++) {
    const ch = valuesText[i];
    if (quote) {
      current += ch;
      if (ch === quote && valuesText[i - 1] !== "\\") {
        if (valuesText[i + 1] === quote) {
          current += valuesText[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") {
      depth++;
      if (depth === 1) {
        inTuple = true;
        current = "";
        continue;
      }
    }
    if (ch === ")") {
      depth--;
      if (depth === 0 && inTuple) {
        rows.push(splitTopLevel(current).map(parseValue));
        inTuple = false;
        continue;
      }
    }
    if (inTuple) current += ch;
  }
  return { table, columns, rows };
}

export function parseSqlDump(sql: string): SqlParseResult {
  const warnings: string[] = [];
  const cleaned = stripComments(sql);
  const statements = splitStatements(cleaned);

  const tableColumns = new Map<string, string[]>();
  const tableRows = new Map<string, Record<string, SqlValue>[]>();

  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;

    if (/^CREATE\s+TABLE/i.test(trimmed)) {
      const parsed = parseCreateTable(trimmed);
      if (parsed && parsed.columns.length) {
        tableColumns.set(parsed.name, parsed.columns);
      }
      continue;
    }

    if (/^INSERT\s+/i.test(trimmed)) {
      const parsed = parseInsert(trimmed);
      if (!parsed) {
        warnings.push(`Could not parse an INSERT statement (skipped): ${trimmed.slice(0, 80)}...`);
        continue;
      }
      let columns = parsed.columns ?? tableColumns.get(parsed.table) ?? null;
      if (!columns) {
        const width = parsed.rows[0]?.length ?? 0;
        columns = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
        warnings.push(
          `"${parsed.table}": no column names found (no CREATE TABLE and no explicit column list) — using column_1, column_2, ...`,
        );
      }
      const existing = tableRows.get(parsed.table) ?? [];
      for (const row of parsed.rows) {
        const obj: Record<string, SqlValue> = {};
        columns.forEach((col, i) => {
          obj[col] = row[i] ?? null;
        });
        existing.push(obj);
      }
      tableRows.set(parsed.table, existing);
      continue;
    }
    // Anything else (ALTER TABLE, SET, comments-only lines, etc.) is silently
    // ignored — it doesn't carry row data.
  }

  const tables: ParsedTable[] = Array.from(tableRows.entries()).map(([name, rows]) => ({
    name,
    columns: tableColumns.get(name) ?? Object.keys(rows[0] ?? {}),
    rows,
  }));

  if (tables.length === 0) {
    warnings.push("No INSERT statements found — nothing to import.");
  }

  return { tables, warnings };
}
