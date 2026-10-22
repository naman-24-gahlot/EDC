import Link from 'next/link';
import type { Timestamp } from 'firebase-admin/firestore';
import { listEvents } from '@/lib/events';
import { entryQuery, parseEntryFilter, runPaged } from '@/lib/logs';
import { formatDateTime } from '@/lib/display';
import { PAGE_SIZE, fetchedAtNow, parsePage } from '@/lib/paging';
import { StatusPill } from '@/components/StatusPill';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { namesFor, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

interface EntryRow {
  eventId?: string | null;
  id: string;
  personId: string | null;
  guardUid: string;
  method: string;
  result: string;
  reason: string | null;
  presentedCode: string | null;
  timestamp: Timestamp;
}

export default async function AdminEntriesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireMasterPage();
  const params = await searchParams;
  const filter = parseEntryFilter(params);
  const person = filter.person;
  const page = parsePage(params.page);

  // Paged in Firestore: only this page's rows are read (plus a count, billed per 1,000 entries).
  const base = entryQuery(filter);
  const [{ building, total, docs }, events] = await Promise.all([runPaged(base, page, PAGE_SIZE), listEvents()]);
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = docs.map((d) => ({ ...(d.data() as Omit<EntryRow, 'id'>), id: d.id }));
  const names = await namesFor([person, ...rows.map((r) => r.personId), ...rows.map((r) => r.guardUid)]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">
          Gate entries{person && <> for <span className="text-gray-900">{names.get(person) ?? 'this person'}</span> · <Link href="/admin/entries" className="underline">show everyone</Link></>}
        </h2>
      </div>
      {/* Plain GET form: Apply filters the page; Download sends the same fields to the CSV export. */}
      <form action="/admin/entries" method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3" aria-label="Filter gate entries">
        {person && <input type="hidden" name="person" value={person} />}
        {([['result', 'Result', [['', 'All'], ['APPROVED', 'Allowed'], ['DENIED', 'Denied']], filter.result ?? ''], ['order', 'Order', [['desc', 'Newest first'], ['asc', 'Oldest first']], filter.order]] as const).map(([name, label, opts, value]) => (
          <label key={name} className="space-y-1 text-xs font-semibold uppercase text-gray-500">
            <span className="block">{label}</span>
            <select name={name} defaultValue={value} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
        {!person && events.length > 0 && (
          <label className="space-y-1 text-xs font-semibold uppercase text-gray-500">
            <span className="block">Event</span>
            <select name="event" defaultValue={filter.event ?? ''} className="max-w-[14rem] rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Any</option>
              <option value="none">Not an event guest</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        )}
        {(['from', 'to'] as const).map((k) => (
          <label key={k} className="space-y-1 text-xs font-semibold uppercase text-gray-500">
            <span className="block">{k === 'from' ? 'From' : 'To'}</span>
            <input type="date" name={k} defaultValue={filter[k] ?? ''} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
        ))}
        <div className="flex flex-wrap gap-2">
          <button className="min-h-10 rounded bg-gray-900 px-4 text-sm font-medium text-white md:min-h-9">Apply</button>
          <button formAction="/api/admin/export/entries" className="min-h-10 rounded border border-gray-400 bg-white px-4 text-sm font-medium md:min-h-9">Download these as CSV</button>
          <Link href={person ? `/admin/entries?person=${person}` : '/admin/entries'} className="inline-flex min-h-10 items-center text-sm text-gray-500 underline md:min-h-9">Reset</Link>
        </div>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">{total} matching {total === 1 ? 'entry' : 'entries'}</p>
        <DataStamp fetchedAt={fetchedAtNow()} pageParams={['page']} />
      </div>
      {building ? <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">This combination of filters is still being prepared by the database (a few minutes after an update). Try again shortly, or change a filter.</p> : rows.length === 0 ? <p className="text-sm text-gray-400">Nothing matches{person ? ' for this person' : ''}.</p> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="rtable w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Guard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td data-label="When" className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{formatDateTime(e.timestamp.toDate())}</td>
                  <td data-label="Person" className="px-3 py-2">
                    {e.personId ? <Link href={`/admin/people/${e.personId}`} className="hover:underline">{names.get(e.personId) ?? e.personId}</Link> : <span className="text-gray-400">unresolved</span>}
                  </td>
                  <td data-label="Method" className="px-3 py-2 text-xs">{e.method}{e.presentedCode ? <span className="font-mono"> {e.presentedCode}</span> : ''}</td>
                  <td data-label="Result" className="px-3 py-2"><StatusPill status={e.result} /></td>
                  <td data-label="Reason" className="px-3 py-2 text-xs">{e.reason ?? '—'}</td>
                  <td data-label="Event" className="px-3 py-2 text-xs">{e.eventId && eventName.has(e.eventId) ? <Link href={`/admin/events/${e.eventId}`} className="underline">{eventName.get(e.eventId)}</Link> : <span className="text-gray-400">—</span>}</td>
                  <td data-label="Guard" className="px-3 py-2 text-xs text-gray-500">{names.get(e.guardUid) ?? e.guardUid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={Math.min(page, pages)} pages={pages} total={total} noun="entries" />
    </div>
  );
}
