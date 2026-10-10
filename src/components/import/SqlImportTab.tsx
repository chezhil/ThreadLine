"use client";
import { useMemo, useRef, useState } from "react";
import { Button, Select, Card, CardHeader, EmptyState } from "@/components/ui";
import { postJson } from "@/lib/useApi";
import { EditableRowsGrid } from "./EditableRowsGrid";
import { guessMapping } from "./guess-mapping";
import type { ImportTargetDef, RowResult } from "./types";

type SqlValue = string | number | boolean | null;
interface ParsedTable {
  name: string;
  columns: string[];
  rowCount: number;
  rows: Record<string, SqlValue>[];
}

function toDisplayString(v: SqlValue): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function SqlImportTab({ targets }: { targets: ImportTargetDef[] }) {
  const [sql, setSql] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tables, setTables] = useState<ParsedTable[] | null>(null);
  const [tableIndex, setTableIndex] = useState(0);
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [editedRows, setEditedRows] = useState<Record<string, string>[] | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const target = targets.find((t) => t.key === targetKey);
  const table = tables?.[tableIndex];

  async function handleParse() {
    setParsing(true);
    setParseError(null);
    const { ok, data } = await postJson<{ tables?: ParsedTable[]; warnings?: string[]; fieldErrors?: Record<string, string[]> }>(
      "/api/import/sql-parse",
      { sql },
    );
    setParsing(false);
    if (!ok || !data.tables) {
      setParseError(Object.values(data.fieldErrors ?? {})[0]?.[0] ?? "Could not parse that file.");
      return;
    }
    setTables(data.tables);
    setWarnings(data.warnings ?? []);
    setTableIndex(0);
    setEditedRows(null);
    setResults(null);
    if (data.tables[0] && target) {
      setMapping(guessMapping(target.fields, data.tables[0].columns));
    }
  }

  function handleFileUpload(file: File) {
    const reader = new FileReader();
    reader.onload = () => setSql(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  const mappedRows = useMemo(() => {
    if (!table || !target) return [];
    return table.rows.map((row) => {
      const out: Record<string, string> = {};
      for (const field of target.fields) {
        const col = mapping[field.key];
        out[field.key] = col ? toDisplayString(row[col]) : "";
      }
      return out;
    });
  }, [table, target, mapping]);

  const rowsToShow = editedRows ?? mappedRows;

  function updateMapping(fieldKey: string, column: string) {
    setMapping((m) => ({ ...m, [fieldKey]: column }));
    setEditedRows(null); // remap from source
  }

  async function handleCommit() {
    if (!target || rowsToShow.length === 0) return;
    setCommitting(true);
    const { data } = await postJson<{ results: RowResult[] }>("/api/import/commit", {
      target: target.key,
      rows: rowsToShow,
    });
    setCommitting(false);
    setResults(data.results);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="1. Paste or upload the .sql file" />
        <input
          ref={fileInputRef}
          type="file"
          accept=".sql,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
          }}
        />
        <div className="mb-2 flex gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
            Upload .sql file
          </Button>
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          placeholder={`INSERT INTO yarn_stock (supplier, yarn, qty_kg) VALUES ('Shree Yarns', 'Cotton 30s', 250);`}
          rows={8}
          className="w-full rounded-md border border-border p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <div className="mt-2">
          <Button type="button" onClick={handleParse} disabled={parsing || !sql.trim()}>
            {parsing ? "Parsing..." : "Parse SQL"}
          </Button>
        </div>
        {parseError && <p className="mt-2 text-sm text-red-600">{parseError}</p>}
        {warnings.map((w, i) => (
          <p key={i} className="mt-1 text-xs text-amber-700">⚠ {w}</p>
        ))}
      </Card>

      {tables && tables.length > 0 && (
        <Card>
          <CardHeader title="2. Pick the table and where it goes" />
          <div className="grid gap-3 md:grid-cols-2">
            {tables.length > 1 && (
              <Select
                label="Table in the file"
                value={String(tableIndex)}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  setTableIndex(idx);
                  setEditedRows(null);
                  setResults(null);
                  if (target && tables[idx]) setMapping(guessMapping(target.fields, tables[idx].columns));
                }}
                options={tables.map((t, i) => ({ value: String(i), label: `${t.name} (${t.rowCount} rows)` }))}
              />
            )}
            <Select
              label="Import as"
              value={targetKey}
              onChange={(e) => {
                setTargetKey(e.target.value);
                setEditedRows(null);
                setResults(null);
                const newTarget = targets.find((t) => t.key === e.target.value);
                if (newTarget && table) setMapping(guessMapping(newTarget.fields, table.columns));
              }}
              options={targets.map((t) => ({ value: t.key, label: t.label }))}
            />
          </div>
        </Card>
      )}

      {table && target && (
        <Card>
          <CardHeader title="3. Match each column" />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {target.fields.map((field) => (
              <Select
                key={field.key}
                label={`${field.label}${field.required ? " *" : ""}`}
                value={mapping[field.key] ?? ""}
                onChange={(e) => updateMapping(field.key, e.target.value)}
                placeholder="— not mapped —"
                options={table.columns.map((c) => ({ value: c, label: c }))}
              />
            ))}
          </div>
        </Card>
      )}

      {table && target && (
        <Card>
          <CardHeader
            title={`4. Preview (${rowsToShow.length} row${rowsToShow.length === 1 ? "" : "s"})`}
            action={
              !results && (
                <Button onClick={handleCommit} disabled={committing || rowsToShow.length === 0}>
                  {committing ? "Importing..." : `Import ${rowsToShow.length} row${rowsToShow.length === 1 ? "" : "s"}`}
                </Button>
              )
            }
          />
          {rowsToShow.length === 0 ? (
            <EmptyState title="Nothing to preview yet" description="Map at least one column above." />
          ) : (
            <EditableRowsGrid
              fields={target.fields}
              rows={rowsToShow}
              onChange={setEditedRows}
              results={results ?? undefined}
            />
          )}
          {results && (
            <p className="mt-3 text-sm text-gray-600">
              {results.filter((r) => r.ok).length} of {results.length} imported.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
