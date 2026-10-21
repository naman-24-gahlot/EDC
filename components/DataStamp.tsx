'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

function ago(fromIso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s} seconds ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : `${Math.round(m / 60)} hour(s) ago`;
}

/**
 * "Updated 2 minutes ago · Refresh". The page you see may be served from the browser's cache
 * (see next.config.ts staleTimes); this says how old it is. Refresh fetches it fresh and goes
 * back to page 1 of every list on the page, keeping search and filters.
 */
export function DataStamp({ fetchedAt, pageParams = ['page'] }: { fetchedAt: string; pageParams?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => new Date(fetchedAt).getTime());

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  function refresh() {
    const q = new URLSearchParams(search.toString());
    const onLaterPage = pageParams.some((p) => q.has(p));
    pageParams.forEach((p) => q.delete(p));
    const s = q.toString();
    startTransition(() => {
      router.refresh(); // discard cached pages, refetch this one
      if (onLaterPage) router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-gray-500" aria-live="polite">
      <span>{pending ? 'Refreshing…' : <>Updated <time dateTime={fetchedAt}>{ago(fetchedAt, now)}</time></>}</span>
      <button
        type="button"
        onClick={refresh}
        disabled={pending}
        className="inline-flex min-h-8 items-center gap-1 rounded border border-gray-300 bg-white px-2.5 font-medium text-gray-700 disabled:opacity-60"
      >
        <span aria-hidden className={pending ? 'inline-block animate-spin motion-reduce:animate-none' : 'inline-block'}>↻</span>
        Refresh
      </button>
    </div>
  );
}
