import Link from 'next/link';
import { formatDateTime } from '@/lib/display';

export interface VisitorRow { personId: string; name: string; vvip: boolean; code: string | null; host: string | null; createdAt: Date | null; passUrl: string; onCampus: boolean; lastEntryAt: Date | null; active: boolean }

// Visitor passes, newest first. The pass link is shown to the host (and Masters) to resend it.
export function VisitorList({ rows, personHrefBase }: { rows: VisitorRow[]; personHrefBase?: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-500">No visitor passes yet.</p>;
  return (
    <ul className="divide-y divide-gray-200 rounded border border-gray-200 bg-white text-sm" data-testid="visitor-list">
      {rows.map((r) => (
        <li key={r.personId} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
          <span className="min-w-0">
            {personHrefBase ? <Link href={personHrefBase + r.personId} className="font-semibold underline">{r.name}</Link> : <b>{r.name}</b>}
            {r.vvip && <b className="ml-1 rounded bg-purple-100 px-1 text-[11px] text-purple-900">VVIP</b>}
            <span className="ml-1 font-mono text-xs">{r.code}</span>
            <span className="block text-xs text-gray-500">
              {r.host ? `host ${r.host} · ` : ''}created {r.createdAt ? formatDateTime(r.createdAt) : '—'}
              {r.onCampus ? ' · on campus now' : r.lastEntryAt ? ` · last in ${formatDateTime(r.lastEntryAt)}` : ' · not arrived yet'}
              {!r.active && ' · switched off'}
            </span>
          </span>
          <span className="flex shrink-0 gap-2">
            <a href={r.passUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-xs font-medium md:min-h-8">Open pass</a>
            <a href={`/print/pass?person=${r.personId}`} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-xs font-medium md:min-h-8">Print</a>
          </span>
        </li>
      ))}
    </ul>
  );
}
