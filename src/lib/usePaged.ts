"use client";
import { useMemo, useState } from "react";

export const LIST_PAGE_SIZE = 25;

/** Client-side paging for a list that's already in memory: only the current
 * page's rows hit the DOM. The page is clamped, so a refetch or a narrower
 * filter can never leave the reader past the end. Pair with the shared
 * <Pager {...paged.pagerProps} /> (render it when `paged.showPager`). */
export function usePaged<T>(rows: readonly T[], pageSize = LIST_PAGE_SIZE) {
  const [requested, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(requested, pageCount);
  const pageRows = useMemo(() => rows.slice((page - 1) * pageSize, page * pageSize), [rows, page, pageSize]);
  return {
    page,
    setPage,
    pageRows,
    showPager: rows.length > pageSize,
    pagerProps: { page, pageSize, total: rows.length, onPageChange: setPage },
  };
}
