"use client";
import { Button } from "@/components/ui";
import type { ImportFieldDef, RowResult } from "./types";

export function EditableRowsGrid({
  fields,
  rows,
  onChange,
  results,
}: {
  fields: ImportFieldDef[];
  rows: Record<string, string>[];
  onChange: (rows: Record<string, string>[]) => void;
  results?: RowResult[];
}) {
  function updateCell(rowIndex: number, key: string, value: string) {
    const next = rows.slice();
    next[rowIndex] = { ...next[rowIndex], [key]: value };
    onChange(next);
  }

  function removeRow(rowIndex: number) {
    onChange(rows.filter((_, i) => i !== rowIndex));
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-gray-50">
          <tr>
            {results && <th className="px-2 py-2 text-left font-medium text-gray-600">Status</th>}
            {fields.map((f) => (
              <th key={f.key} className="px-2 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                {f.label}
                {f.required && <span className="text-red-500"> *</span>}
              </th>
            ))}
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-white">
          {rows.map((row, i) => {
            const result = results?.find((r) => r.index === i);
            return (
              <tr key={i} className={result && !result.ok ? "bg-red-50" : ""}>
                {results && (
                  <td className="px-2 py-1.5 align-top">
                    {!result && <span className="text-xs text-gray-400">pending</span>}
                    {result?.ok && <span className="text-xs font-medium text-green-700">✓ {result.message}</span>}
                    {result && !result.ok && <span className="text-xs font-medium text-red-700">✗ {result.message}</span>}
                  </td>
                )}
                {fields.map((f) => (
                  <td key={f.key} className="px-1 py-1 align-top">
                    <input
                      value={row[f.key] ?? ""}
                      onChange={(e) => updateCell(i, f.key, e.target.value)}
                      placeholder={f.example}
                      disabled={!!results}
                      className="w-full min-w-[9rem] rounded border border-transparent bg-transparent px-1.5 py-1 text-sm focus:border-border focus:bg-white focus:outline-none disabled:opacity-70"
                    />
                  </td>
                ))}
                <td className="px-1 py-1 align-top">
                  {!results && (
                    <button
                      type="button"
                      onClick={() => removeRow(i)}
                      className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-red-600"
                    >
                      ✕
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!results && (
        <div className="border-t border-border p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([...rows, Object.fromEntries(fields.map((f) => [f.key, ""]))])}
          >
            + Add row
          </Button>
        </div>
      )}
    </div>
  );
}
