import Link from 'next/link';
import { eventTiming, listEvents, linkState, type EventTiming } from '@/lib/events';

// Ongoing first (what's happening now), then what's coming, then history.
const GROUPS: [EventTiming, string][] = [['ongoing', 'Happening now'], ['upcoming', 'Coming up'], ['past', 'Past events']];
import { todayDateString } from '@/lib/date';
import { formatDate, formatDateTime } from '@/lib/display';
import { fetchedAtNow } from '@/lib/paging';
import { StatusPill } from '@/components/StatusPill';
import { DataStamp } from '@/components/DataStamp';
import { eventCounts, requireMasterPage } from '../data';
import { EventForm } from './EventForm';

export const dynamic = 'force-dynamic';

export default async function AdminEventsPage() {
  await requireMasterPage();
  const events = await listEvents();
  const counts = await eventCounts(events.map((e) => e.id));
  const today = todayDateString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Events with their own registration link ({events.length})</h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>

      <details className="rounded-lg border border-gray-200 bg-gray-50 p-4" open={events.length === 0}>
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm font-semibold md:min-h-0">+ New event</summary>
        <p className="mb-3 mt-1 text-xs text-gray-500">Creates a registration page with its own link. Anyone with the link can register (any profile type) until the time you set; you approve them here, and approved people get access for the event days and hours.</p>
        <EventForm initial={{ name: '', details: '', venue: '', accessFrom: today, accessTo: today, gateOpens: '09:00', gateCloses: '18:00', linkExpiresAt: `${today}T23:59` }} />
      </details>

      {events.length === 0 && <p className="text-sm text-gray-400">No events yet.</p>}
      {GROUPS.map(([timing, title]) => {
        const list = events.filter((e) => eventTiming(e, today) === timing)
          .sort((a, b) => (timing === 'past' ? b.accessTo.localeCompare(a.accessTo) : a.accessFrom.localeCompare(b.accessFrom)));
        if (list.length === 0) return null;
        return (
      <section key={timing} className="space-y-2" aria-labelledby={`t-${timing}`}>
        <h3 id={`t-${timing}`} className="text-sm font-semibold">{title} <span className="font-normal text-gray-400">{list.length}</span></h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          {list.map((e) => {
            const c = counts.get(e.id)!;
            const state = linkState(e);
            return (
              <li key={e.id}>
                <Link href={`/admin/events/${e.id}`} className="block space-y-2 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-400" data-event={e.id}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 font-semibold">{e.name}</p>
                    <StatusPill status={state === 'OPEN' ? 'LINK OPEN' : state === 'CLOSED' ? 'LINK CLOSED' : 'LINK EXPIRED'} />
                  </div>
                  <p className="text-xs text-gray-500">
                    {e.accessFrom === e.accessTo ? formatDate(e.accessFrom) : `${formatDate(e.accessFrom)} – ${formatDate(e.accessTo)}`} · {e.gateOpens}–{e.gateCloses}
                    {state === 'OPEN' && <> · registration until {formatDateTime(e.linkExpiresAt.toDate())}</>}
                  </p>
                  <p className="text-sm">
                    <b className={c.PENDING ? 'text-amber-700' : ''}>{c.PENDING} waiting</b> · {c.APPROVED} approved · {c.REJECTED} rejected
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
        );
      })}
    </div>
  );
}
