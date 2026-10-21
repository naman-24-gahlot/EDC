// Pure paging helpers, shared by server pages (no server-only imports — unit-tested).

export const PAGE_SIZE = 25;

/** `?page=` (or any param) → a page number ≥ 1; anything odd becomes 1. */
export function parsePage(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

export interface Page<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

/** Slice an already-loaded, already-sorted list. A page past the end shows the last page. */
export function paginate<T>(all: T[], page: number, size = PAGE_SIZE): Page<T> {
  const pages = Math.max(1, Math.ceil(all.length / size));
  const p = Math.min(Math.max(1, page), pages);
  return { items: all.slice((p - 1) * size, p * size), page: p, pages, total: all.length };
}

/** Server-render time, passed to the "Updated … ago" bar (kept out of component bodies). */
export function fetchedAtNow(): string {
  return new Date().toISOString();
}
