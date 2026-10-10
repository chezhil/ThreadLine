"use client";
import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { ScanNoteTab } from "./ScanNoteTab";
import { SqlImportTab } from "./SqlImportTab";
import type { ImportTargetDef } from "./types";

type Tab = "scan" | "sql";

export function ImportClient() {
  const [tab, setTab] = useState<Tab>("scan");
  const { data, loading, error } = useApi<{ targets: ImportTargetDef[] }>("/api/import/targets");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Data Import</h1>
        <p className="text-sm text-gray-500">
          Bring in existing records from handwritten registers or an old system&apos;s SQL export. Nothing is
          written until you review and confirm.
        </p>
      </div>

      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setTab("scan")}
          className={`px-3 py-2 text-sm font-medium ${tab === "scan" ? "border-b-2 border-brand text-brand" : "text-gray-500"}`}
        >
          Scan a handwritten note
        </button>
        <button
          onClick={() => setTab("sql")}
          className={`px-3 py-2 text-sm font-medium ${tab === "sql" ? "border-b-2 border-brand text-brand" : "text-gray-500"}`}
        >
          Import a SQL file
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading...</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && tab === "scan" && <ScanNoteTab targets={data.targets} />}
      {data && tab === "sql" && <SqlImportTab targets={data.targets} />}
    </div>
  );
}
