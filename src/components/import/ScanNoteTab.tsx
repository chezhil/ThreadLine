"use client";
import { useRef, useState } from "react";
import { Button, Select, Card, CardHeader, EmptyState } from "@/components/ui";
import { postJson } from "@/lib/useApi";
import { EditableRowsGrid } from "./EditableRowsGrid";
import type { ImportTargetDef, RowResult } from "./types";

export function ScanNoteTab({ targets }: { targets: ImportTargetDef[] }) {
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [committing, setCommitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const target = targets.find((t) => t.key === targetKey);

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      setImageBase64(dataUrl);
      setRows(null);
      setResults(null);
      setExtractError(null);
    };
    reader.readAsDataURL(file);
  }

  async function handleExtract() {
    if (!imageBase64 || !target) return;
    setExtracting(true);
    setExtractError(null);
    const { ok, data } = await postJson<{ rows?: Record<string, string>[]; error?: string }>(
      "/api/import/ocr",
      { target: target.key, imageBase64 },
    );
    setExtracting(false);
    if (!ok || !data.rows) {
      setExtractError(data.error ?? "Could not read that image.");
      return;
    }
    setRows(data.rows);
  }

  async function handleCommit() {
    if (!rows || !target) return;
    setCommitting(true);
    const { data } = await postJson<{ results: RowResult[] }>("/api/import/commit", {
      target: target.key,
      rows,
    });
    setCommitting(false);
    setResults(data.results);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader title="1. What kind of register is this?" />
        <Select
          value={targetKey}
          onChange={(e) => {
            setTargetKey(e.target.value);
            setRows(null);
            setResults(null);
          }}
          options={targets.map((t) => ({ value: t.key, label: t.label }))}
        />
        {target && <p className="mt-2 text-sm text-gray-500">{target.description}</p>}
      </Card>

      <Card>
        <CardHeader title="2. Photo of the page" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => fileInputRef.current?.click()}>
            {imagePreview ? "Choose a different photo" : "Take or choose a photo"}
          </Button>
          {imagePreview && (
            <Button type="button" onClick={handleExtract} disabled={extracting}>
              {extracting ? "Reading..." : "Extract rows"}
            </Button>
          )}
        </div>
        {imagePreview && (
          // eslint-disable-next-line @next/next/no-img-element -- local data: URL preview, not a servable asset
          <img src={imagePreview} alt="Uploaded register page" className="mt-3 max-h-80 rounded-md border border-border object-contain" />
        )}
        {extractError && (
          <p className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{extractError}</p>
        )}
      </Card>

      {rows && target && (
        <Card>
          <CardHeader
            title={`3. Check what was read (${rows.length} row${rows.length === 1 ? "" : "s"})`}
            action={
              !results && (
                <Button onClick={handleCommit} disabled={committing || rows.length === 0}>
                  {committing ? "Importing..." : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
                </Button>
              )
            }
          />
          <p className="mb-3 text-sm text-gray-500">
            Handwriting recognition isn&apos;t perfect — fix anything wrong before importing. Nothing is saved until you click Import.
          </p>
          {rows.length === 0 ? (
            <EmptyState title="No rows left" description="Every row was removed." />
          ) : (
            <EditableRowsGrid fields={target.fields} rows={rows} onChange={setRows} results={results ?? undefined} />
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
