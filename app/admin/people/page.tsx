import Link from 'next/link';
import { todayDateString } from '@/lib/date';
import { accessCodeFor } from '@/lib/access/codes';
import { currentEntitlementsFor, effectiveStatus } from '@/lib/access/entitlements';
import { PROFILE_LABEL, accessStatus, formatDateTime } from '@/lib/display';
import { fetchedAtNow, paginate, parsePage } from '@/lib/paging';
import { CATEGORIES, SORTS, VIEWS, categoryOf, countByCategory, lastEntryMillis, parseCategory, parseSort, parseView, sortPeople } from '@/lib/people/browse';
import type { PersonRecord } from '@/lib/hierarchy/authorize';
import { StatusPill } from '@/components/StatusPill';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { Chips } from '@/components/Chips';
import { CardGrid, PersonCard, type PersonCardData } from '@/components/PersonCard';
import { allPeople, nameMap, requireMasterPage } from '../data';
import { EventTag } from '@/components/EventTag';
import { eventTiming, listEvents, type EventSummary, type EventTiming } from '@/lib/events';
import { PAGE_SIZE } from '@/lib/paging';
import { formatDate } from '@/lib/display';

export const dynamic = 'force-dynamic';

const STATUSES = [['any', 'Any'], ['active', 'Active'], ['ended', 'No / expired access'], ['pending', 'Awaiting approval'], ['off', 'Revoked, deactivated or rejected']] as const;
const STATUS_MATCH: Record<string, (s: string) => boolean> = {
  active: (s) => s === 'ACTIVE' || s === 'NOT YET ACTIVE' || s === 'GUARD',
  ended: (s) => s === 'NONE' || s === 'EXPIRED',
  pending: (s) => s === 'PENDING APPROVAL',
  off: (s) => s === 'REVOKED' || s === 'DEACTIVATED' || s === 'REJECTED',
};
const PREVIEW = 6;

type Params = { q?: string; page?: string; cat?: string; sort?: string; view?: string; status?: string; ev?: string };
const TIMINGS = [['ongoing', 'Ongoing events'], ['upcoming', 'Upcoming events'], ['past', 'Past events']] as const;
const TIMING_LABEL: Record<EventTiming, string> = { ongoing: 'ONGOING', upcoming: 'UPCOMING', past: 'PAST' };

export default async function AdminPeoplePage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireMasterPage();
  const params = await searchParams;
  const q = (params.q ?? '').trim().toLowerCase().slice(0, 100);
  const cat = parseCategory(params.cat);
  const sort = parseSort(params.sort);
  const view = parseView(params.view);
  const statusFilter = STATUSES.find(([v]) => v === params.status)?.[0] ?? 'any';
  const [people, events] = await Promise.all([allPeople(), listEvents()]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const eventOf = (p: PersonRecord) => (typeof p.eventId === 'string' ? eventById.get(p.eventId) ?? null : null);
  // Event filter: a timing group, "none" (not from any event), one event's id, or any.
  const ev = params.ev && (TIMINGS.some(([t]) => t === params.ev) || params.ev === 'none' || eventById.has(params.ev)) ? params.ev : 'any';
  const matchesEvent = (p: PersonRecord) => {
    const e = eventOf(p);
    if (ev === 'any') return true;
    if (ev === 'none') return !e;
    if (eventById.has(ev)) return e?.id === ev;
    return !!e && eventTiming(e, todayDateString()) === ev;
  };
  const names = nameMap(people);
  const today = todayDateString();
  const codeOf = (p: PersonRecord) => accessCodeFor(p.profileType, p.accessNumber) ?? '';

  // Master's scope is everyone, so search and filters are conveniences, not authorization.
  const searched = people.filter((p) => !q || [p.firstName, p.lastName, `${p.firstName} ${p.lastName}`, p.username, codeOf(p), p.profileType ?? 'guard'].some((s) => s.toLowerCase().includes(q)));
  const counts = countByCategory(searched);
  const inCategory = searched.filter((p) => cat === 'all' || categoryOf(p) === cat);
  const evCount = (pred: (p: PersonRecord) => boolean) => inCategory.filter(pred).length;
  const timingOfPerson = (p: PersonRecord) => { const e = eventOf(p); return e ? eventTiming(e, todayDateString()) : null; };
  let matching = sortPeople(inCategory.filter(matchesEvent), sort, codeOf);

  // Access status needs entitlements: read them for everyone only when filtering by status.
  const statusOf = new Map<string, string>();
  async function loadStatuses(list: PersonRecord[]) {
    const ents = await currentEntitlementsFor(list.filter((p) => !statusOf.has(p.personId)).map((p) => p.personId));
    for (const p of list) {
      const e = ents.get(p.personId);
      if (!statusOf.has(p.personId)) statusOf.set(p.personId, p.systemRole === 'guard' ? 'GUARD' : accessStatus(p, e ? effectiveStatus(e, today) : null));
    }
  }
  if (statusFilter !== 'any') {
    await loadStatuses(matching);
    matching = matching.filter((p) => STATUS_MATCH[statusFilter](statusOf.get(p.personId)!));
  }

  // Overview (nothing narrowed yet): recently at the gate up top, a preview of each category below.
  const overview = cat === 'all' && !q && statusFilter === 'any' && ev === 'any' && !params.page;
  // Grouped by event: the overview's "now and coming up", or a timing filter's events.
  const byEvent = (timings: readonly EventTiming[]) => events
    .filter((e) => timings.includes(eventTiming(e, todayDateString())))
    .sort((a, b) => (eventTiming(a) === 'past' ? b.accessTo.localeCompare(a.accessTo) : a.accessFrom.localeCompare(b.accessFrom)))
    .map((e) => ({ e, items: matching.filter((p) => eventOf(p)?.id === e.id) }))
    .filter((g) => g.items.length);
  const eventGroups = overview ? byEvent(['ongoing', 'upcoming']) : TIMINGS.some(([t]) => t === ev) ? byEvent([ev as EventTiming]) : [];
  const recent = overview ? sortPeople(people.filter((p) => lastEntryMillis(p) > 0), 'recent', codeOf).slice(0, PREVIEW) : [];
  const groups = overview
    ? CATEGORIES.slice(1).map(([c, label]) => ({ c, label, items: matching.filter((p) => categoryOf(p) === c) })).filter((g) => g.items.length)
    : [];
  const paged = paginate(matching, parsePage(params.page));
  await loadStatuses(overview ? [...recent, ...eventGroups.flatMap((g) => g.items.slice(0, PREVIEW)), ...groups.flatMap((g) => g.items.slice(0, PREVIEW))]
    : eventGroups.length ? eventGroups.flatMap((g) => g.items.slice(0, PAGE_SIZE)) : paged.items);

  const card = (p: PersonRecord): PersonCardData => ({
    personId: p.personId, firstName: p.firstName, lastName: p.lastName, username: p.username, category: categoryOf(p),
    typeLabel: p.systemRole === 'master' ? 'Master' : p.profileType ? PROFILE_LABEL[p.profileType] : 'Guard',
    code: codeOf(p) || null, status: statusOf.get(p.personId) ?? 'NONE',
    lastEntry: lastEntryMillis(p) ? formatDateTime(new Date(lastEntryMillis(p))) : null,
    under: p.parentId ? names.get(p.parentId) ?? null : null,
    event: eventOf(p) ? { id: eventOf(p)!.id, name: eventOf(p)!.name } : null,
  });
  const keep = { q: q || undefined, cat: params.cat, sort: params.sort, view: params.view, status: params.status, ev: params.ev };
  const eventSection = (g: { e: EventSummary; items: PersonRecord[] }, limit: number) => (
    <section key={g.e.id} className="space-y-2" aria-labelledby={`ev-${g.e.id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`ev-${g.e.id}`} className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Link href={`/admin/events/${g.e.id}`} className="hover:underline">{g.e.name}</Link>
          <StatusPill status={TIMING_LABEL[eventTiming(g.e)]} />
          <span className="font-normal text-gray-500">{g.e.accessFrom === g.e.accessTo ? formatDate(g.e.accessFrom) : `${formatDate(g.e.accessFrom)} – ${formatDate(g.e.accessTo)}`} · {g.items.length} {g.items.length === 1 ? 'person' : 'people'}</span>
        </h2>
        {g.items.length > limit && <Link href={`/admin/people?${new URLSearchParams({ ...(params.view ? { view: params.view } : {}), ev: g.e.id })}`} className="inline-flex min-h-10 items-center text-xs underline md:min-h-0">See all {g.items.length} →</Link>}
      </div>
      {show(g.items.slice(0, limit))}
    </section>
  );
  const show = (list: PersonRecord[]) => view === 'cards'
    ? <CardGrid>{list.map((p) => <PersonCard key={p.personId} p={card(p)} href={`/admin/people/${p.personId}`} />)}</CardGrid>
    : <PeopleTable rows={list.map(card)} />;

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" role="search">
        {(['cat', 'sort', 'view', 'status'] as const).map((k) => params[k] && <input key={k} type="hidden" name={k} value={params[k]} />)}
        <input name="q" defaultValue={q} placeholder="Search name, username, code or type" aria-label="Search people"
          className="min-w-0 flex-1 basis-48 rounded border border-gray-300 px-3 py-2 text-sm" />
        <button className="min-h-10 rounded bg-gray-900 px-4 text-sm font-medium text-white">Search</button>
        {q && <Link href="/admin/people" className="self-center text-sm text-gray-500 underline">Clear</Link>}
      </form>

      <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <Chips label="Category" param="cat" path="/admin/people" params={keep} current={cat} options={CATEGORIES.map(([v, l]) => [v, l, counts[v]] as const)} />
        <Chips label="Access" param="status" path="/admin/people" params={keep} current={statusFilter} options={STATUSES} />
        {events.length > 0 && (
          <Chips label="Event" param="ev" path="/admin/people" params={keep} current={eventById.has(ev) ? 'one' : ev}
            options={[['any', 'Any'], ...TIMINGS.map(([t, l]) => [t, l, evCount((p) => timingOfPerson(p) === t)] as const), ['none', 'Not from an event', evCount((p) => !eventOf(p))],
              ...(eventById.has(ev) ? [['one', eventById.get(ev)!.name, matching.length] as const] : [])]} />
        )}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Chips label="Sort" param="sort" path="/admin/people" params={keep} current={sort} options={SORTS} />
          <Chips label="View" param="view" path="/admin/people" params={keep} current={view} options={VIEWS} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">{matching.length} of {people.length} people</p>
        <DataStamp fetchedAt={fetchedAtNow()} pageParams={['page']} />
      </div>

      {overview ? (
        <>
          {recent.length > 0 && (
            <section className="space-y-2" aria-labelledby="recent-h">
              <h2 id="recent-h" className="text-sm font-semibold">Recently at the gate</h2>
              {show(recent)}
            </section>
          )}
          {eventGroups.length > 0 && (
            <div className="space-y-4 rounded-lg border border-violet-200 bg-violet-50/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">Events now and coming up</p>
              {eventGroups.map((g) => eventSection(g, PREVIEW))}
            </div>
          )}
          {groups.map((g) => (
            <section key={g.c} className="space-y-2" aria-labelledby={`g-${g.c}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 id={`g-${g.c}`} className="text-sm font-semibold">{g.label} <span className="font-normal text-gray-400">{g.items.length}</span></h2>
                {g.items.length > PREVIEW && (
                  <Link href={`/admin/people?${new URLSearchParams({ ...(params.sort ? { sort: params.sort } : {}), ...(params.view ? { view: params.view } : {}), cat: g.c })}`}
                    className="inline-flex min-h-10 items-center text-xs underline md:min-h-0">See all {g.items.length} →</Link>
                )}
              </div>
              {show(g.items.slice(0, PREVIEW))}
            </section>
          ))}
        </>
      ) : eventGroups.length > 0 ? (
        <div className="space-y-5">{eventGroups.map((g) => eventSection(g, PAGE_SIZE))}</div>
      ) : matching.length === 0 ? (
        <p className="text-sm text-gray-400">Nobody matches these filters.</p>
      ) : (
        <>
          {show(paged.items)}
          <Pager page={paged.page} pages={paged.pages} total={paged.total} noun="people" />
        </>
      )}
    </div>
  );
}

function PeopleTable({ rows }: { rows: PersonCardData[] }) {
  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="rtable w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Code</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Under</th>
            <th className="px-3 py-2">Last at gate</th>
            <th className="px-3 py-2">Access</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((p) => (
            <tr key={p.personId} data-person={p.username}>
              <td data-label="" className="px-3 py-2">
                <Link href={`/admin/people/${p.personId}`} className="font-medium hover:underline">{p.firstName} {p.lastName}</Link>
                <span className="ml-1 text-xs text-gray-400">@{p.username}</span>
                {p.event && <span className="mt-0.5 block"><EventTag id={p.event.id} name={p.event.name} /></span>}
              </td>
              <td data-label="Code" className="px-3 py-2 font-mono text-xs">{p.code ?? '—'}</td>
              <td data-label="Type" className="px-3 py-2 text-xs">{p.typeLabel}</td>
              <td data-label="Under" className="px-3 py-2 text-xs">{p.under ?? '—'}</td>
              <td data-label="Last at gate" className="px-3 py-2 text-xs text-gray-500">{p.lastEntry ?? 'never'}</td>
              <td data-label="Access" className="px-3 py-2"><StatusPill status={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
