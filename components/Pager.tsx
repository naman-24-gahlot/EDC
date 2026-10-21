'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

function Spinner() {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : null;
}

/**
 * Previous / Next for a server-paged list. Keeps every other query param (search, filters).
 * `param` lets one page hold two independent lists (e.g. "people" and "requests" on /me).
 */
export function Pager({ page, pages, total, param = 'page', noun = 'items' }: { page: number; pages: number; total: number; param?: string; noun?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  if (pages <= 1) return null;

  const href = (p: number) => {
    const q = new URLSearchParams(search.toString());
    if (p <= 1) q.delete(param);
    else q.set(param, String(p));
    const s = q.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const link = 'inline-flex min-h-10 items-center rounded border border-gray-300 bg-white px-3 text-sm font-medium';

  return (
    <nav aria-label={`${noun} pages`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-gray-500">
        Page {page} of {pages} · {total} {noun}
      </span>
      <span className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} scroll={false} className={link}>← Previous<Spinner /></Link> : <span className={`${link} opacity-40`} aria-disabled>← Previous</span>}
        {page < pages ? <Link href={href(page + 1)} scroll={false} className={link}>Next →<Spinner /></Link> : <span className={`${link} opacity-40`} aria-disabled>Next →</span>}
      </span>
    </nav>
  );
}
