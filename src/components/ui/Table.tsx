"use client";
import { ReactNode } from "react";
import { LIST_PAGE_SIZE, usePaged } from "@/lib/usePaged";
import { Pager } from "./Pager";

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /** Needed when two columns share a header (e.g. two blank action columns). */
  key?: string;
}

export interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  keyFor: (row: T) => string;
  emptyState?: ReactNode;
  /** Rows per page (default 25) — every list pages the same way. Pass
   * `false` when the caller already pages on the server. */
  pageSize?: number | false;
}

export function Table<T>({ columns, rows, keyFor, emptyState, pageSize = LIST_PAGE_SIZE }: TableProps<T>) {
  const paged = usePaged(rows, pageSize || Math.max(1, rows.length));
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="scrollbar-thin overflow-x-auto rounded-md border border-border/80 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-surface-low">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key ?? col.header}
                  className="label-caps px-3 py-2.5 text-left text-gray-600 whitespace-nowrap"
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-white">
            {paged.pageRows.map((row) => (
              <tr key={keyFor(row)} className="transition-colors hover:bg-brand-soft/30">
                {columns.map((col) => (
                  <td key={col.key ?? col.header} className={`px-3 py-2.5 whitespace-nowrap tabular-nums text-gray-800 ${col.className ?? ""}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {paged.showPager && <Pager {...paged.pagerProps} />}
    </div>
  );
}
