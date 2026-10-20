import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { todayDateString } from '@/lib/date';
import { loadPerson } from '@/lib/hierarchy/authorize';
import { accessCodeFor } from '@/lib/access/codes';
import { effectiveStatus, listEntitlements, templateWindow } from '@/lib/access/entitlements';
import { listRequestsFor } from '@/lib/access/requests';
import { PROFILE_LABEL, accessStatus, daysLabel, formatDate, formatDateTime } from '@/lib/display';
import { StatusPill } from '@/components/StatusPill';
import { allPeople, nameMap, requireMasterPage } from '../../data';
import { PersonActions } from './PersonActions';

export const dynamic = 'force-dynamic';

const toDate = (v: unknown) => (v as { toDate?: () => Date } | null)?.toDate?.() ?? null;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {children}
    </section>
  );
}

export default async function AdminPersonPage({ params }: { params: Promise<{ personId: string }> }) {
  const user = await requireMasterPage();
  const { personId } = await params;
  const person = await loadPerson(personId);
  if (!person) notFound();

  const today = todayDateString();
  const [people, entitlements, requests, eventsSnap, auditSnap, historySnap] = await Promise.all([
    allPeople(),
    listEntitlements(personId),
    listRequestsFor(personId),
    adminDb.collection('entryEvents').where('personId', '==', personId).get(),
    adminDb.collection('auditLogs').where('targetPersonId', '==', personId).get(),
    adminDb.collection('people').doc(personId).collection('profileHistory').get(),
  ]);
  const names = nameMap(people);
  const descendants = people.filter((p) => p.ancestorIds.includes(personId));
  const current = entitlements.find((e) => e.state === 'ACTIVE') ?? entitlements[0] ?? null;
  const status = person.systemRole === 'guard' ? 'GUARD' : accessStatus(person, current ? effectiveStatus(current, today) : null);
  const events = eventsSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (toDate(b.timestamp)?.getTime() ?? 0) - (toDate(a.timestamp)?.getTime() ?? 0)).slice(0, 50);
  const audits = auditSnap.docs.map((d) => Object.assign({ id: d.id }, d.data())).sort((a, b) => (toDate(b.timestamp)?.getTime() ?? 0) - (toDate(a.timestamp)?.getTime() ?? 0)).slice(0, 100);
  const history = historySnap.docs.map((d) => d.data()).sort((a, b) => (toDate(b.changedAt)?.getTime() ?? 0) - (toDate(a.changedAt)?.getTime() ?? 0));

  // Convenience only — the server re-checks every rule in rehome().
  const eligibleParents = people
    .filter((p) => p.personId !== personId && p.profileType === 'employee' && p.registrationStatus === 'APPROVED' && p.active && !p.ancestorIds.includes(personId))
    .map((p) => ({ id: p.personId, name: `${p.firstName} ${p.lastName}${p.systemRole === 'master' ? ' (Master)' : ''}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const activeEnt = entitlements.find((e) => e.state === 'ACTIVE') ?? null;

  return (
    <div className="space-y-6">
      <p className="text-xs"><Link href="/admin/people" className="text-gray-500 underline">← All people</Link></p>

      <div className="flex flex-wrap items-start gap-4">
        {typeof person.photoDataUrl === 'string' ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL from the person doc
          <img src={person.photoDataUrl} alt="" className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-600">{person.firstName[0]}{person.lastName[0]}</div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold" data-testid="person-name">{person.firstName} {person.lastName}</h2>
          <p className="text-sm text-gray-500">
            @{person.username} · {person.profileType ? PROFILE_LABEL[person.profileType] : 'Guard'}
            {person.systemRole === 'master' && ' · Master'} · code <span className="font-mono" data-testid="person-code">{accessCodeFor(person.profileType, person.accessNumber) ?? '—'}</span>
          </p>
          <p className="text-sm text-gray-500">
            Parent: {person.parentId ? <Link href={`/admin/people/${person.parentId}`} className="underline">{names.get(person.parentId)}</Link> : 'top-level'}
            {' · '}{descendants.length} below · registration <StatusPill status={person.registrationStatus} /> {!person.active && person.registrationStatus === 'APPROVED' && <StatusPill status="DEACTIVATED" />}
          </p>
          <p className="text-xs text-gray-400">{String(person.commEmail ?? '')} · {String(person.mobile ?? '')} · credential v{person.credentialVersion}</p>
        </div>
        <div className="text-right"><StatusPill status={status} /></div>
      </div>

      <PersonActions
        key={`${person.profileType}-${person.active}`}
        person={{
          personId, name: `${person.firstName} ${person.lastName}`, isSelf: personId === user.personId,
          systemRole: person.systemRole, profileType: person.profileType, parentId: person.parentId,
          active: person.active, registrationStatus: person.registrationStatus, hasDescendants: descendants.length > 0,
        }}
        eligibleParents={eligibleParents}
        template={person.profileType && person.registrationStatus === 'APPROVED' && person.active ? templateWindow(person.profileType, today) : null}
        activeEntitlementId={activeEnt?.id ?? null}
      />

      <Section title={`Entitlements (${entitlements.length})`}>
        {entitlements.length === 0 ? <p className="text-sm text-gray-400">None.</p> : (
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
            {entitlements.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-entitlement={e.id}>
                <span>
                  {formatDate(e.startDate)} → {e.endDate ? formatDate(e.endDate) : 'open-ended'} · {daysLabel(e.weekdays)} · {e.startTime}–{e.endTime}
                  <span className="text-xs text-gray-500"> · {PROFILE_LABEL[e.profileTypeAtGrant]} · by {names.get(e.approvedBy) ?? e.approvedBy}{e.sourceRequestId ? ' (request)' : ' (direct)'}{e.revokeReason ? ` · “${e.revokeReason}”` : ''}</span>
                </span>
                <StatusPill status={effectiveStatus(e, today)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Requests (${requests.length})`}>
        {requests.length === 0 ? <p className="text-sm text-gray-400">None.</p> : (
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>{r.purpose} <span className="text-xs text-gray-500">· {formatDateTime(r.createdAt.toDate())} · by {r.requestedBy === personId ? 'self' : names.get(r.requestedBy) ?? r.requestedBy}{r.decidedBy ? ` · decided by ${names.get(r.decidedBy) ?? r.decidedBy}` : ''}</span></span>
                <StatusPill status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Entry events (${events.length}${eventsSnap.size > 50 ? ` of ${eventsSnap.size}` : ''})`}>
        {events.length === 0 ? <p className="text-sm text-gray-400">None.</p> : (
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>{toDate(e.timestamp) ? formatDateTime(toDate(e.timestamp)!) : '—'} <span className="text-xs text-gray-500">· {String(e.method)}{e.presentedCode ? ` ${e.presentedCode}` : ''}{e.reason ? ` · ${e.reason}` : ''}</span></span>
                <StatusPill status={String(e.result)} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {history.length > 0 && (
        <Section title="Profile history">
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
            {history.map((h, i) => (
              <li key={i} className="px-3 py-2">
                {PROFILE_LABEL[h.fromProfileType as keyof typeof PROFILE_LABEL]} → {PROFILE_LABEL[h.toProfileType as keyof typeof PROFILE_LABEL]}
                <span className="text-xs text-gray-500"> · <span className="font-mono">{String(h.retiredAccessCode ?? '—')} → {String(h.newAccessCode ?? '—')}</span> · {toDate(h.changedAt) ? formatDateTime(toDate(h.changedAt)!) : ''} · by {names.get(String(h.changedBy)) ?? String(h.changedBy)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={`Audit (${audits.length})`}>
        <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-xs">
          {audits.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-2 px-3 py-1.5">
              <span className="text-gray-500">{toDate(a.timestamp) ? formatDateTime(toDate(a.timestamp)!) : '—'}</span>
              <span className="font-semibold">{String(a.action)}</span>
              <span className="text-gray-500">by {names.get(String(a.actorId)) ?? String(a.actorId)}</span>
              {a.details ? <span className="text-gray-600">· {String(a.details)}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
