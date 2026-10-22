import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { toPerson } from '@/lib/hierarchy/authorize';
import { PROFILE_LABEL, formatDateTime, windowSummary } from '@/lib/display';
import { fetchedAtNow, paginate, parsePage } from '@/lib/paging';
import { todayDateString } from '@/lib/date';
import { eventWindow, loadEvent } from '@/lib/events';
import { approveOptions } from '@/lib/people/approveRegistration';
import { StatusPill } from '@/components/StatusPill';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { Chips } from '@/components/Chips';
import { DecisionTable, type DecisionRow } from '@/components/DecisionTable';
import { RegistrationDecision } from '@/components/RegistrationDecision';
import { namesFor, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

const STATUS = [['PENDING', 'Waiting'], ['REJECTED', 'Rejected'], ['ALL', 'Both']] as const;
const millis = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

export default async function AdminRegistrationsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string; event?: string }> }) {
  const user = await requireMasterPage();
  const params = await searchParams;
  const status = STATUS.find(([v]) => v === params.status)?.[0] ?? 'PENDING';
  // Only people still waiting (or rejected) — not the whole people table.
  const snap = await adminDb.collection('people').where('registrationStatus', 'in', ['PENDING', 'REJECTED']).get();
  const open = snap.docs.map((d) => toPerson(d)!);

  // Event chips: every event someone here registered through, plus "no event".
  const eventNames = new Map<string, string>();
  for (const p of open) if (typeof p.eventId === 'string') eventNames.set(p.eventId, String(p.eventName ?? 'Event'));
  const eventFilter = params.event === 'none' || (params.event && eventNames.has(params.event)) ? params.event : 'all';
  const inStatus = open.filter((p) => status === 'ALL' || p.registrationStatus === status);
  const matching = inStatus
    .filter((p) => eventFilter === 'all' || (eventFilter === 'none' ? !p.eventId : p.eventId === eventFilter))
    .sort((a, b) => Number(b.registrationStatus === 'PENDING') - Number(a.registrationStatus === 'PENDING') || millis(a.createdAt) - millis(b.createdAt));
  const view = paginate(matching, parsePage(params.page));

  const [names, events] = await Promise.all([
    namesFor(view.items.map((p) => p.parentId)),
    Promise.all([...new Set(view.items.map((p) => p.eventId).filter((x): x is string => typeof x === 'string'))].map(loadEvent)),
  ]);
  const today = todayDateString();
  const eventAccess = new Map(events.filter((e) => e).map((e) => [e!.id, e!.accessTo >= today ? windowSummary(eventWindow(e!)) : 'none — the event is over']));
  const options = approveOptions(user);
  const countIn = (pred: (p: (typeof open)[number]) => boolean) => inStatus.filter(pred).length;

  const rows: DecisionRow[] = view.items.map((p) => {
    const created = millis(p.createdAt);
    const evAccess = typeof p.eventId === 'string' ? eventAccess.get(p.eventId) : undefined;
    return {
      id: p.personId,
      label: `${p.firstName} ${p.lastName}`,
      selectable: p.registrationStatus === 'PENDING',
      cells: [
        <div key="n"><Link href={`/admin/people/${p.personId}`} className="font-medium hover:underline">{p.firstName} {p.lastName}</Link><span className="block text-xs text-gray-500">@{p.username}</span></div>,
        <span key="t" className="text-xs">{p.profileType ? PROFILE_LABEL[p.profileType] : '—'}{p.parentId ? ` · under ${names.get(p.parentId) ?? '—'}` : ''}</span>,
        <span key="e" className="text-xs">{typeof p.eventId === 'string' ? <Link href={`/admin/events/${p.eventId}`} className="underline">{String(p.eventName ?? 'Event')}</Link> : <span className="text-gray-400">General</span>}</span>,
        <span key="w" className="whitespace-nowrap text-xs text-gray-500">{created ? formatDateTime(new Date(created)) : '—'}</span>,
        p.profileType
          ? <RegistrationDecision key="d" personId={p.personId} name={`${p.firstName} ${p.lastName}`} status={p.registrationStatus} appliedAs={p.profileType}
              options={evAccess ? options.map((o) => ({ ...o, access: `${evAccess} (event access)` })) : options} />
          : <StatusPill key="s" status={p.registrationStatus} />,
      ],
    };
  });

  const keep = { status: params.status, event: params.event };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Registrations ({matching.length})</h2>
        <DataStamp fetchedAt={fetchedAtNow()} pageParams={['page']} />
      </div>
      <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <Chips label="Status" param="status" path="/admin/registrations" params={keep} current={status}
          options={STATUS.map(([v, l]) => [v, l, v === 'ALL' ? open.length : open.filter((p) => p.registrationStatus === v).length] as const)} />
        <Chips label="From" param="event" path="/admin/registrations" params={keep} current={eventFilter}
          options={[['all', 'Everywhere', inStatus.length], ['none', 'General sign-up', countIn((p) => !p.eventId)],
            ...[...eventNames].map(([id, n]) => [id, n, countIn((p) => p.eventId === id)] as const)]} />
      </div>
      <DecisionTable kind="registration" headers={['Person', 'Applied as', 'From', 'Registered', 'Decision']} rows={rows}
        approveTypes={options.map((o) => ({ type: o.type, label: o.label }))}
        empty={status === 'PENDING' ? 'Nobody is waiting for approval.' : 'Nothing here.'} />
      <Pager page={view.page} pages={view.pages} total={view.total} noun="registrations" />
    </div>
  );
}
