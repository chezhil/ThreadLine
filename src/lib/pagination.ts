// Shared opt-in pagination for list GET routes: a request with no `page`
// param gets the old, unpaginated behaviour (every existing caller — select
// dropdowns, "link this expense to an order" pickers, etc. — keeps working
// unchanged); passing `page` switches a route into paginated mode.
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export interface PageParams {
  /** True only when the request explicitly asked to paginate. */
  paginated: boolean;
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export function parsePageParams(searchParams: URLSearchParams): PageParams {
  const rawPage = searchParams.get("page");
  const paginated = rawPage !== null;
  const page = Math.max(1, Number(rawPage) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("pageSize")) || DEFAULT_PAGE_SIZE));
  return { paginated, page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
