import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { LIST_FIELDS, toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { eventOptions, eventWindow, linkState, loadEvent } from '@/lib/events';
import { approveOptions } from '@/lib/people/approveRegistration';
import { PROFILE_LABEL, formatDate, formatDateTime, windowSummary } from '@/lib/display';
import { fetchedAtNow } from '@/lib/paging';
import { todayDateString } from '@/lib/date';
import { StatusPill } from '@/components/StatusPill';
import { DataStamp } from '@/components/DataStamp';
import { Chips } from '@/components/Chips';
import { DecisionTable, type DecisionRow } from '@/components/DecisionTable';
import { RegistrationDecision } from '@/components/RegistrationDecision';
import { istInput, requireMasterPage, siteOrigin } from '../../data';
import { EventForm } from '../EventForm';
import { LinkPanel } from '../LinkPanel';
import { ApplicantProfile } from '@/components/ApplicantProfile';
import { EventReport } from './EventReport';

export const dynamic = 'force-dynamic';

const STATUS = [['PENDING', 'Waiting'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['ALL', 'All']] as const;
const millis = (v: unknown) => (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
type Source = { source: string | null; medium: string | null; campaign: string | null } | undefined;
const channel = (s: Source) => (s?.source ? [s.source, s.medium, s.campaign].filter(Boolean).join(' / ') : 'direct link (untagged)');

export default async function AdminEventPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ status?: string }> }) {
  const user = await requireMasterPage();
  const { eventId } = await params;
  const event = await loadEvent(eventId);
  if (!event) notFound();
  const { status: rawStatus } = await searchParams;
  const status = STATUS.find(([v]) => v === rawStatus)?.[0] ?? 'PENDING';

  const [snap, origin] = await Promise.all([adminDb.collection('people').where('eventId', '==', eventId).select(...LIST_FIELDS).get(), siteOrigin()]);
  const everyone = snap.docs.map((d) => toPerson(d)!);
  const count = (s: string) => everyone.filter((p) => p.registrationStatus === s).length;
  const shown = everyone
    .filter((p) => status === 'ALL' || p.registrationStatus === status)
    .sort((a, b) => Number(b.registrationStatus === 'PENDING') - Number(a.registrationStatus === 'PENDING') || millis(b.createdAt) - millis(a.createdAt));
  const state = linkState(event);
  // What approving gives, shown in each row's own "Approve as": the event's days and hours, whatever the type.
  const eventAccess = event.accessTo >= todayDateString() ? windowSummary(eventWindow(event)) : 'none — the event is over';
  const options = approveOptions(user).map((o) => ({ ...o, access: eventAccess }));

  const byChannel = new Map<string, { total: number; approved: number }>();
  for (const p of everyone) {
    const k = channel(p.registrationSource as Source);
    const row = byChannel.get(k) ?? { total: 0, approved: 0 };
    row.total++; if (p.registrationStatus === 'APPROVED') row.approved++;
    byChannel.set(k, row);
  }

  const rows: DecisionRow[] = shown.map((p: PersonRecord) => ({
    id: p.personId,
    label: `${p.firstName} ${p.lastName}`,
    selectable: p.registrationStatus === 'PENDING',
    cells: [
      <div key="n"><Link href={`/admin/people/${p.personId}`} className="font-medium hover:underline">{p.firstName} {p.lastName}</Link><span className="block text-xs text-gray-500">@{p.username} · {String(p.mobile ?? '')}</span>{p.registrationStatus === 'PENDING' && <ApplicantProfile personId={p.personId} />}</div>,
      <span key="t" className="text-xs">{p.profileType ? PROFILE_LABEL[p.profileType] : '—'}</span>,
      <span key="c" className="text-xs text-gray-600">{channel(p.registrationSource as Source)}</span>,
      <span key="w" className="whitespace-nowrap text-xs text-gray-500">{millis(p.createdAt) ? formatDateTime(new Date(millis(p.createdAt))) : '—'}</span>,
      p.registrationStatus === 'PENDING' && p.profileType
        ? <RegistrationDecision key="d" personId={p.personId} name={`${p.firstName} ${p.lastName}`} status={p.registrationStatus} appliedAs={p.profileType} options={options} />
        : <StatusPill key="s" status={p.registrationStatus} />,
    ],
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/events" className="inline-flex min-h-10 items-center text-xs text-gray-500 underline md:min-h-0">← All events</Link>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-bold" data-testid="event-title">{event.name}</h2>
          <StatusPill status={`LINK ${state}`} />
        </div>
        <p className="text-sm text-gray-500">
          {event.accessFrom === event.accessTo ? formatDate(event.accessFrom) : `${formatDate(event.accessFrom)} – ${formatDate(event.accessTo)}`} · gate {event.gateOpens}–{event.gateCloses}{event.venue ? ` · ${event.venue}` : ''}
        </p>
        <p className="text-sm"><b className={count('PENDING') ? 'text-amber-700' : ''}>{count('PENDING')} waiting</b> · {count('APPROVED')} approved · {count('REJECTED')} rejected</p>
      </div>

      <EventReport event={event} people={everyone} />

      <section className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="text-sm font-semibold">Registration link</h3>
        <LinkPanel eventId={event.id} token={event.linkToken} state={state} expires={formatDateTime(event.linkExpiresAt.toDate())} origin={origin} />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Registrations</h3>
          <Chips label="Show" param="status" path={`/admin/events/${event.id}`} params={{ status: rawStatus }} current={status}
            options={STATUS.map(([v, l]) => [v, l, v === 'ALL' ? everyone.length : count(v)] as const)} />
        </div>
        <p className="text-xs text-gray-500">Approving gives access for the event: <b>{eventAccess}</b>. Dependants who didn&apos;t name an employee are placed under you.</p>
        <DecisionTable kind="registration" headers={['Person', 'Applied as', 'Shared via', 'Registered', 'Decision']} rows={rows}
          approveTypes={options.map((o) => ({ type: o.type, label: o.label }))}
          empty={status === 'PENDING' ? 'Nobody is waiting.' : 'Nobody here yet.'} />
      </section>

      {byChannel.size > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Sign-ups by channel</h3>
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="rtable w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-3 py-2">Shared via</th><th className="px-3 py-2">Registered</th><th className="px-3 py-2">Approved</th></tr></thead>
              <tbody className="divide-y divide-gray-200">
                {[...byChannel].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => (
                  <tr key={k}><td data-label="" className="px-3 py-2">{k}</td><td data-label="Registered" className="px-3 py-2">{v.total}</td><td data-label="Approved" className="px-3 py-2">{v.approved}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className="rounded-lg border border-gray-200 p-4">
        <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm font-semibold md:min-h-0">Edit event details</summary>
        <div className="mt-3">
          <EventForm eventId={event.id} initial={{
            name: event.name, details: event.details, venue: event.venue, accessFrom: event.accessFrom, accessTo: event.accessTo,
            gateOpens: event.gateOpens, gateCloses: event.gateCloses, linkExpiresAt: istInput(event.linkExpiresAt), options: eventOptions(event),
          }} />
          <p className="mt-2 text-xs text-gray-500">Changing the dates or hours affects people approved from now on; people already approved keep the access they were given (edit theirs on their page).</p>
        </div>
      </details>
    </div>
  );
}
