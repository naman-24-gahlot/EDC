import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { todayDateString } from '@/lib/date';
import { loadPerson, toPerson } from '@/lib/hierarchy/authorize';
import { PROFILE_TYPES, accessCodeFor } from '@/lib/access/codes';
import { effectiveStatus, listEntitlements, templateWindow } from '@/lib/access/entitlements';
import { listRequestsFor } from '@/lib/access/requests';
import { PROFILE_LABEL, accessStatus, daysLabel, formatDate, formatDateTime } from '@/lib/display';
import { fetchedAtNow } from '@/lib/paging';
import { StatusPill } from '@/components/StatusPill';
import { SkeletonBlock } from '@/components/Skeleton';
import { DataStamp } from '@/components/DataStamp';
import { namesFor, requireMasterPage } from '../../data';
import { PersonActions } from './PersonActions';
import { EventTag } from '@/components/EventTag';

export const dynamic = 'force-dynamic';

const RECENT = 10;
const toDate = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.() ?? null;

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const List = ({ children }: { children: React.ReactNode }) => <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">{children}</ul>;
const SectionLoading = ({ title }: { title: string }) => <Section title={title}><SkeletonBlock className="h-16 w-full" /></Section>;

// Streamed after the top of the page: these read only this person's recent history.
async function RequestsSection({ personId }: { personId: string }) {
  const requests = await listRequestsFor(personId);
  const names = await namesFor([...requests.map((r) => r.requestedBy), ...requests.map((r) => r.decidedBy)]);
  return (
    <Section title={`Requests (${requests.length})`}>
      {requests.length === 0 ? <p className="text-sm text-gray-400">None.</p> : (
        <List>
          {requests.slice(0, RECENT).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0">{r.purpose} <span className="text-xs text-gray-500">· {formatDateTime(r.createdAt.toDate())} · by {r.requestedBy === personId ? 'self' : names.get(r.requestedBy) ?? r.requestedBy}{r.decidedBy ? ` · decided by ${names.get(r.decidedBy) ?? r.decidedBy}` : ''}</span></span>
              <StatusPill status={r.status} />
            </li>
          ))}
        </List>
      )}
      {requests.length > RECENT && <p className="text-xs text-gray-500">Showing the latest {RECENT} of {requests.length}.</p>}
    </Section>
  );
}

async function EntriesSection({ personId }: { personId: string }) {
  const q = adminDb.collection('entryEvents').where('personId', '==', personId).orderBy('timestamp', 'desc');
  const [count, snap] = await Promise.all([q.count().get(), q.limit(RECENT).get()]);
  const total = count.data().count;
  return (
    <Section title={`Gate entries (${total})`} action={total > RECENT ? <Link href={`/admin/entries?person=${personId}`} className="inline-flex min-h-10 items-center md:min-h-0 text-xs underline">See all →</Link> : null}>
      {snap.empty ? <p className="text-sm text-gray-400">None.</p> : (
        <List>
          {snap.docs.map((d) => { const e = d.data(); return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>{toDate(e.timestamp) ? formatDateTime(toDate(e.timestamp)!) : '—'} <span className="text-xs text-gray-500">· {String(e.method)}{e.presentedCode ? ` ${e.presentedCode}` : ''}{e.reason ? ` · ${e.reason}` : ''}</span></span>
              <StatusPill status={String(e.result)} />
            </li>
          ); })}
        </List>
      )}
    </Section>
  );
}

async function HistorySection({ personId }: { personId: string }) {
  const snap = await adminDb.collection('people').doc(personId).collection('profileHistory').get();
  if (snap.empty) return null;
  const history = snap.docs.map((d) => d.data()).sort((a, b) => (toDate(b.changedAt)?.getTime() ?? 0) - (toDate(a.changedAt)?.getTime() ?? 0));
  const names = await namesFor(history.map((h) => String(h.changedBy)));
  return (
    <Section title="Profile history">
      <List>
        {history.map((h, i) => (
          <li key={i} className="px-3 py-2">
            {PROFILE_LABEL[h.fromProfileType as keyof typeof PROFILE_LABEL]} → {PROFILE_LABEL[h.toProfileType as keyof typeof PROFILE_LABEL]}
            <span className="text-xs text-gray-500"> · <span className="font-mono">{String(h.retiredAccessCode ?? '—')} → {String(h.newAccessCode ?? '—')}</span> · {toDate(h.changedAt) ? formatDateTime(toDate(h.changedAt)!) : ''} · by {names.get(String(h.changedBy)) ?? String(h.changedBy)}</span>
          </li>
        ))}
      </List>
    </Section>
  );
}

async function AuditSection({ personId }: { personId: string }) {
  const q = adminDb.collection('auditLogs').where('targetPersonId', '==', personId).orderBy('timestamp', 'desc');
  const [count, snap] = await Promise.all([q.count().get(), q.limit(RECENT).get()]);
  const total = count.data().count;
  const names = await namesFor(snap.docs.map((d) => String(d.data().actorId)));
  return (
    <Section title={`Audit (${total})`} action={total > RECENT ? <Link href={`/admin/audit?person=${personId}`} className="inline-flex min-h-10 items-center md:min-h-0 text-xs underline">See all →</Link> : null}>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-xs">
        {snap.docs.map((d) => { const a = d.data(); const actor = String(a.actorId); return (
          <li key={d.id} className="flex flex-wrap gap-x-2 px-3 py-1.5">
            <span className="text-gray-500">{toDate(a.timestamp) ? formatDateTime(toDate(a.timestamp)!) : '—'}</span>
            <span className="font-semibold">{String(a.action)}</span>
            <span className="text-gray-500">by {actor === 'system' || actor === 'public' ? actor : names.get(actor) ?? actor}</span>
            {a.details ? <span className="text-gray-600">· {String(a.details)}</span> : null}
          </li>
        ); })}
      </ul>
    </Section>
  );
}

export default async function AdminPersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const user = await requireMasterPage();
  const { personId } = await params;
  if (!/^[A-Za-z0-9]{1,128}$/.test(personId)) notFound();

  const today = todayDateString();
  // Just what the top of the page needs; history sections stream in below.
  const [person, entitlements, employeesSnap, descendantsSnap] = await Promise.all([
    loadPerson(personId),
    listEntitlements(personId),
    adminDb.collection('people').where('profileType', '==', 'employee').get(),
    adminDb.collection('people').where('ancestorIds', 'array-contains', personId).select().get(),
  ]);
  if (!person) notFound();
  const descendantIds = new Set(descendantsSnap.docs.map((d) => d.id));
  const names = await namesFor([person.parentId, ...entitlements.map((e) => e.approvedBy)]);
  const current = entitlements.find((e) => e.state === 'ACTIVE') ?? entitlements[0] ?? null;
  const status = person.systemRole === 'guard' ? 'GUARD' : accessStatus(person, current ? effectiveStatus(current, today) : null);

  // Convenience only — the server re-checks every rule in rehome().
  const eligibleParents = employeesSnap.docs
    .map((d) => toPerson(d)!)
    .filter((p) => p.personId !== personId && p.registrationStatus === 'APPROVED' && p.active && !descendantIds.has(p.personId))
    .map((p) => ({ id: p.personId, name: `${p.firstName} ${p.lastName}${p.systemRole === 'master' ? ' (Master)' : ''}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const activeEnt = entitlements.find((e) => e.state === 'ACTIVE') ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/people" className="inline-flex min-h-10 items-center md:min-h-0 text-xs text-gray-500 underline">← All people</Link>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {typeof person.photoDataUrl === 'string' ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL from the person doc
          <img src={person.photoDataUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-600">{person.firstName[0]}{person.lastName[0]}</div>
        )}
        <div className="min-w-0 flex-1 basis-52">
          <h2 className="text-xl font-bold" data-testid="person-name">{person.firstName} {person.lastName}</h2>
          <p className="text-sm text-gray-500">
            @{person.username} · {person.profileType ? PROFILE_LABEL[person.profileType] : 'Guard'}
            {person.systemRole === 'master' && ' · Master'} · code <span className="font-mono" data-testid="person-code">{accessCodeFor(person.profileType, person.accessNumber) ?? '—'}</span>
          </p>
          <p className="text-sm text-gray-500">
            {typeof person.eventId === 'string' && <><EventTag id={person.eventId} name={String(person.eventName ?? 'Event')} />{(person.registrationSource as { source?: string } | undefined)?.source ? <span className="text-xs"> via {(person.registrationSource as { source: string }).source}</span> : null}{' · '}</>}
            Parent: {person.parentId ? <Link href={`/admin/people/${person.parentId}`} className="underline">{names.get(person.parentId)}</Link> : 'top-level'}
            {' · '}{descendantIds.size} below · registration <StatusPill status={person.registrationStatus} /> {!person.active && person.registrationStatus === 'APPROVED' && <StatusPill status="DEACTIVATED" />}
          </p>
          <p className="break-all text-xs text-gray-400">{String(person.commEmail ?? '')} {person.emailVerified === true ? <span className="text-emerald-700">✓ confirmed</span> : <span className="text-amber-700">(not confirmed)</span>}
            {(() => { const c = person.idCheck as { type?: string; last4?: string | null; at?: { toDate: () => Date } } | undefined; return c?.type ? <> · photo ID seen: {c.type}{c.last4 ? ` ending ${c.last4}` : ''}{c.at ? ` (${formatDateTime(c.at.toDate())})` : ''}</> : <> · photo ID not checked yet</>; })()} · {String(person.mobile ?? '')} · credential v{person.credentialVersion}</p>
        </div>
        <div><StatusPill status={status} /></div>
      </div>

      <PersonActions
        person={{
          personId, name: `${person.firstName} ${person.lastName}`, isSelf: personId === user.personId,
          systemRole: person.systemRole, profileType: person.profileType, parentId: person.parentId,
          active: person.active, registrationStatus: person.registrationStatus, hasDescendants: descendantIds.size > 0,
        }}
        eligibleParents={eligibleParents}
        templates={Object.fromEntries(PROFILE_TYPES.map((t) => [t, templateWindow(t, today)]))}
        grantBlocked={person.registrationStatus !== 'APPROVED' ? 'Approve their registration first — then you can grant access here.'
          : !person.active ? 'Reactivate them first — then you can grant access here.' : null}
        current={activeEnt ? {
          id: activeEnt.id, status: effectiveStatus(activeEnt, today),
          window: { startDate: activeEnt.startDate, endDate: activeEnt.endDate, weekdays: activeEnt.weekdays, startTime: activeEnt.startTime, endTime: activeEnt.endTime },
        } : null}
        details={{ firstName: person.firstName, lastName: person.lastName, mobile: String(person.mobile ?? ''), purpose: String(person.purpose ?? '') }}
      />

      <Section title={`Entitlements (${entitlements.length})`}>
        {entitlements.length === 0 ? <p className="text-sm text-gray-400">None.</p> : (
          <List>
            {entitlements.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-entitlement={e.id}>
                <span className="min-w-0">
                  {formatDate(e.startDate)} → {e.endDate ? formatDate(e.endDate) : 'open-ended'} · {daysLabel(e.weekdays)} · {e.startTime}–{e.endTime}
                  <span className="text-xs text-gray-500"> · {PROFILE_LABEL[e.profileTypeAtGrant]} · by {names.get(e.approvedBy) ?? e.approvedBy}{e.sourceRequestId ? ' (request)' : ' (direct)'}{e.revokeReason ? ` · “${e.revokeReason}”` : ''}</span>
                </span>
                <StatusPill status={effectiveStatus(e, today)} />
              </li>
            ))}
          </List>
        )}
      </Section>

      <Suspense fallback={<SectionLoading title="Requests" />}><RequestsSection personId={personId} /></Suspense>
      <Suspense fallback={<SectionLoading title="Gate entries" />}><EntriesSection personId={personId} /></Suspense>
      <Suspense fallback={null}><HistorySection personId={personId} /></Suspense>
      <Suspense fallback={<SectionLoading title="Audit" />}><AuditSection personId={personId} /></Suspense>
    </div>
  );
}
