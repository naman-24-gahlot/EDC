import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { todayDateString } from '@/lib/date';
import { listDescendants, loadPerson, toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { accessCodeFor } from '@/lib/access/codes';
import { effectiveStatus, getCurrentEntitlement, type Entitlement } from '@/lib/access/entitlements';
import { listApprovalQueue, listRequestsFor, type AccessRequest } from '@/lib/access/requests';
import { RoleHeader } from '@/components/RoleHeader';
import { PROFILE_LABEL, STATUS_STYLE, accessStatus, daysLabel, formatDate, formatDateTime } from '@/lib/display';
import { ReissueButton } from './ReissueButton';
import { RequestForm } from './RequestForm';
import { DecisionButtons } from '@/components/DecisionButtons';
import { CreatePersonForm } from './CreatePersonForm';
import { GrantButton } from './GrantButton';

export const dynamic = 'force-dynamic';

/** Current entitlement per person (ACTIVE, else most recent) — chunked `in` queries, not N reads. */
async function currentEntitlements(personIds: string[]): Promise<Map<string, Entitlement>> {
  const byPerson = new Map<string, Entitlement[]>();
  for (let i = 0; i < personIds.length; i += 30) {
    const snap = await adminDb.collection('entitlements').where('personId', 'in', personIds.slice(i, i + 30)).get();
    for (const doc of snap.docs) {
      const e = { ...(doc.data() as Omit<Entitlement, 'id'>), id: doc.id };
      byPerson.set(e.personId, [...(byPerson.get(e.personId) ?? []), e]);
    }
  }
  const out = new Map<string, Entitlement>();
  for (const [id, list] of byPerson) {
    list.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    out.set(id, list.find((e) => e.state === 'ACTIVE') ?? list[0]);
  }
  return out;
}

function Pill({ status }: { status: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ring-1 ${STATUS_STYLE[status] ?? STATUS_STYLE.NONE}`}>{status}</span>;
}

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-xl border border-[#D5DDE4] bg-[#F7F9FB] p-4">
      <h2 id={id} className="text-sm font-semibold uppercase tracking-wide text-[#46596B]">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-dashed border-[#D5DDE4] py-1.5 text-sm last:border-0">
      <dt className="text-[#7C8C9B]">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

export default async function MePage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const me = await loadPerson(user.personId);
  if (!me) redirect('/login');

  const today = todayDateString();
  const isMaster = user.systemRole === 'master';
  const canManage = isMaster || (me.profileType === 'employee' && me.registrationStatus === 'APPROVED' && me.active);

  const [current, myRequests] = await Promise.all([getCurrentEntitlement(me.personId), listRequestsFor(me.personId)]);
  const myEffective = current ? effectiveStatus(current, today) : null;
  const myStatus = accessStatus(me, myEffective);
  const period = current && myEffective !== 'SUPERSEDED' ? current : null;
  const pending = myRequests.find((r) => r.status === 'PENDING');

  let people: PersonRecord[] = [];
  let queue: AccessRequest[] = [];
  let peopleEnts = new Map<string, Entitlement>();
  if (canManage) {
    // Listing scope is decided here, server-side: Master everyone, anyone else their descendants.
    people = isMaster
      ? (await adminDb.collection('people').get()).docs.map((d) => toPerson(d)!).filter((p) => p.personId !== me.personId)
      : await listDescendants(me.personId);
    queue = await listApprovalQueue(user);
    peopleEnts = await currentEntitlements(people.map((p) => p.personId));
    people.sort((a, b) => a.ancestorIds.length - b.ancestorIds.length || a.firstName.localeCompare(b.firstName));
  }
  const nameOf = new Map(people.map((p) => [p.personId, `${p.firstName} ${p.lastName}`]));
  const pendingByPerson = new Map(queue.map((r) => [r.personId, r]));
  const pendingRegistrations = people.filter((p) => p.registrationStatus === 'PENDING');
  const name = `${me.firstName} ${me.lastName}`;
  const photo = typeof me.photoDataUrl === 'string' ? me.photoDataUrl : null;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 text-[#1B2A38]">
      <RoleHeader role={user.systemRole} subtitle={me.username} />

      <div className="flex items-center gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL from the person doc
          <img src={photo} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DCEAF1] font-semibold text-[#0D5B7A]">{me.firstName[0]}{me.lastName[0]}</div>
        )}
        <div>
          <h1 className="text-xl font-bold">{name}</h1>
          <p className="text-sm text-[#46596B]">{me.profileType ? PROFILE_LABEL[me.profileType] : '—'}</p>
        </div>
        {isMaster && <Link href="/admin" className="ml-auto text-sm font-medium text-[#0D5B7A] underline">Admin dashboard →</Link>}
      </div>

      <Section title="Profile" id="profile">
        <dl>
          <Row label="Name" value={name} />
          <Row label="Username" value={<span className="font-mono">{me.username}</span>} />
          <Row label="EDC email" value={typeof me.edcEmail === 'string' && me.edcEmail ? me.edcEmail : <span className="text-[#7C8C9B]">not assigned</span>} />
          <Row label="Communication email" value={String(me.commEmail ?? '—')} />
          <Row label="Mobile" value={String(me.mobile ?? '—')} />
          <Row label="Profile type" value={me.profileType ? PROFILE_LABEL[me.profileType] : '—'} />
          <Row label="Registration" value={<Pill status={me.registrationStatus} />} />
        </dl>
      </Section>

      <Section title="Access" id="access">
        <dl>
          <Row label="Status" value={<Pill status={myStatus} />} />
          <Row label="Access code" value={<span className="font-mono text-base font-semibold tracking-wider">{accessCodeFor(me.profileType, me.accessNumber) ?? '—'}</span>} />
          <Row label="From" value={period ? formatDate(period.startDate) : '—'} />
          <Row label="Until" value={period ? (period.endDate ? formatDate(period.endDate) : 'Open-ended') : '—'} />
          <Row label="Days" value={period ? daysLabel(period.weekdays) : '—'} />
          <Row label="Hours" value={period ? `${period.startTime}–${period.endTime}` : '—'} />
        </dl>
        <div className="flex flex-wrap items-start justify-between gap-3 pt-1">
          <Link href="/me/pass" className="rounded bg-[#0D5B7A] px-3 py-2 text-sm font-semibold text-white">Open my entry pass</Link>
          {me.registrationStatus === 'APPROVED' && <ReissueButton />}
        </div>
      </Section>

      <Section title="My requests" id="requests">
        <RequestForm
          disabledReason={
            me.registrationStatus !== 'APPROVED' ? 'You can request access once your registration is approved.'
              : !me.active ? 'Your account is deactivated.'
              : pending ? `Your request is waiting for a decision (expires ${formatDateTime(pending.actionableUntil.toDate())} if nobody decides).`
              : null
          }
        />
        {myRequests.length === 0 ? (
          <p className="text-sm text-[#7C8C9B]">No requests yet.</p>
        ) : (
          <ul className="divide-y divide-[#D5DDE4]" data-testid="my-requests">
            {myRequests.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{r.purpose}</p>
                  <p className="text-xs text-[#7C8C9B]">
                    {formatDateTime(r.createdAt.toDate())}
                    {r.requestedStartDate && ` · from ${formatDate(r.requestedStartDate)}`}
                    {r.requestedEndDate && ` until ${formatDate(r.requestedEndDate)}`}
                    {r.decisionNote && ` · “${r.decisionNote}”`}
                  </p>
                </div>
                <Pill status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {canManage && (
        <Section title={isMaster ? 'Everyone' : 'People under me'} id="people">
          <CreatePersonForm />

          {queue.length > 0 && (
            <div className="space-y-2" data-testid="request-queue">
              <h3 className="text-sm font-semibold">Access requests to decide ({queue.length})</h3>
              <ul className="space-y-2">
                {queue.map((r) => (
                  <li key={r.id} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p><span className="font-semibold">{nameOf.get(r.personId) ?? 'Unknown'}</span> — {r.purpose}</p>
                    <p className="mb-2 text-xs text-[#7C8C9B]">
                      {r.requestedStartDate ? `from ${formatDate(r.requestedStartDate)} ` : ''}{r.requestedEndDate ? `until ${formatDate(r.requestedEndDate)} · ` : ''}
                      expires {formatDateTime(r.actionableUntil.toDate())}
                    </p>
                    <DecisionButtons base={`/api/requests/${r.id}`} what={`access request for ${nameOf.get(r.personId) ?? 'person'}`} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingRegistrations.length > 0 && (
            <div className="space-y-2" data-testid="registration-queue">
              <h3 className="text-sm font-semibold">Registrations to decide ({pendingRegistrations.length})</h3>
              <ul className="space-y-2">
                {pendingRegistrations.map((p) => (
                  <li key={p.personId} className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                    <p className="mb-2"><span className="font-semibold">{p.firstName} {p.lastName}</span> <span className="text-[#7C8C9B]">@{p.username} · {p.profileType ? PROFILE_LABEL[p.profileType] : '—'}</span></p>
                    <DecisionButtons base={`/api/registrations/${p.personId}`} what={`registration of ${p.firstName} ${p.lastName}`} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {people.length === 0 ? (
            <p className="text-sm text-[#7C8C9B]">Nobody here yet.</p>
          ) : (
            <ul className="divide-y divide-[#D5DDE4]" data-testid="people-list">
              {people.map((p) => {
                const ent = peopleEnts.get(p.personId) ?? null;
                const status = p.systemRole === 'guard' ? 'GUARD' : accessStatus(p, ent ? effectiveStatus(ent, today) : null);
                const depth = Math.max(0, p.ancestorIds.length - (isMaster ? 0 : me.ancestorIds.length + 1));
                return (
                  <li key={p.personId} className="flex items-center justify-between gap-3 py-2 text-sm" style={{ paddingLeft: depth * 16 }} data-person={p.username}>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.firstName} {p.lastName} <span className="font-normal text-[#7C8C9B]">@{p.username}</span></p>
                      <p className="text-xs text-[#7C8C9B]">
                        {p.systemRole === 'master' ? 'Master · ' : ''}{p.profileType ? PROFILE_LABEL[p.profileType] : 'Guard'}
                        {accessCodeFor(p.profileType, p.accessNumber) && <> · <span className="font-mono">{accessCodeFor(p.profileType, p.accessNumber)}</span></>}
                        {pendingByPerson.has(p.personId) && <span className="font-semibold text-amber-700"> · request pending</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {p.profileType && (status === 'NONE' || status === 'EXPIRED') && !pendingByPerson.has(p.personId) && (
                        <GrantButton personId={p.personId} name={`${p.firstName} ${p.lastName}`} />
                      )}
                      <Pill status={status} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      )}
    </main>
  );
}
