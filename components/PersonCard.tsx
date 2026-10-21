import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';

const TINT: Record<string, string> = {
  master: 'bg-purple-100 text-purple-800', employee: 'bg-sky-100 text-sky-800', incubee: 'bg-teal-100 text-teal-800',
  guest: 'bg-amber-100 text-amber-800', dependant: 'bg-rose-100 text-rose-800', guard: 'bg-slate-200 text-slate-800',
};

export interface PersonCardData {
  personId: string;
  firstName: string;
  lastName: string;
  username: string;
  category: string;
  typeLabel: string;
  code: string | null;
  status: string;
  lastEntry: string | null;
  under?: string | null;
}

// Initials, not photos: a page of cards stays a few KB instead of megabytes of data URLs.
export function PersonCard({ p, href, footer }: { p: PersonCardData; href?: string; footer?: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-start gap-3">
        <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold uppercase ${TINT[p.category] ?? TINT.guard}`}>
          {p.firstName[0]}{p.lastName[0]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{p.firstName} {p.lastName}</p>
          <p className="truncate text-xs text-gray-500">@{p.username}</p>
        </div>
        <StatusPill status={p.status} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
        <dt className="text-gray-400">Type</dt><dd className="truncate text-right">{p.typeLabel}</dd>
        <dt className="text-gray-400">Code</dt><dd className="truncate text-right font-mono">{p.code ?? '—'}</dd>
        {p.under !== undefined && <><dt className="text-gray-400">Under</dt><dd className="truncate text-right">{p.under ?? 'top-level'}</dd></>}
        <dt className="text-gray-400">Last at gate</dt><dd className="truncate text-right">{p.lastEntry ?? 'never'}</dd>
      </dl>
      {footer && <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">{footer}</div>}
    </>
  );
  const cls = 'block rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm';
  return href
    ? <Link href={href} className={`${cls} transition hover:border-gray-400 hover:shadow`} data-person={p.username}>{body}</Link>
    : <div className={cls} data-person={p.username}>{body}</div>;
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}
