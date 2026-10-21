import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { requirePageRole, type SessionUser } from '@/lib/session';
import { todayDateString } from '@/lib/date';
import { listDescendants, loadPerson, toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { accessCodeFor, isProfileType } from '@/lib/access/codes';
import { currentEntitlementsFor, effectiveStatus, getCurrentEntitlement, templateWindow } from '@/lib/access/entitlements';
import { listApprovalQueue, listRequestsFor } from '@/lib/access/requests';
import { fetchedAtNow, paginate, parsePage } from '@/lib/paging';
import { RoleHeader } from '@/components/RoleHeader';
import { SkeletonBlock } from '@/components/Skeleton';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { Chips } from '@/components/Chips';
import { CardGrid, PersonCard } from '@/components/PersonCard';
import { CATEGORIES, SORTS, VIEWS, categoryOf, countByCategory, lastEntryMillis, parseCategory, parseView, sortPeople } from '@/lib/people/browse';
import { PROFILE_LABEL, STATUS_STYLE, accessStatus, daysLabel, formatDate, formatDateTime, windowSummary } from '@/lib/display';
import { ReissueButton } from './ReissueButton';
import { RequestForm } from './RequestForm';
import { DecisionButtons } from '@/components/DecisionButtons';
import { RegistrationDecision } from '@/components/RegistrationDecision';
import { approveOptions } from '@/lib/people/approveRegistration';
import { CreatePersonForm } from './CreatePersonForm';
import { GrantButton } from './GrantButton';
import { AccountSettings } from './AccountSettings';
import { ApprovalNotice } from './ApprovalNotice';

export const dynamic = 'force-dynamic';

const MY_REQUESTS_PER_PAGE = 10;

function Pill({ status }: { status: string }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold tracking-wide ring-1 ${STATUS_STYLE[status] ?? STATUS_STYLE.NONE}`}>{status}</span>;
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
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b border-dashed border-[#D5DDE4] py-1.5 text-sm last:border-0">
      <dt className="text-[#7C8C9B]">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}

/**
 * The expensive part of /me — streamed in after the rest of the page is already on screen.
 * Scope is decided here, server-side: Master everyone, anyone else their descendants.
 */
const ME_SORTS = [['tree', 'By hierarchy'], ...SORTS] as const;
type MeParams = { people?: string; requests?: string; pcat?: string; psort?: string; pview?: string };

async function PeopleSection({ user, me, params }: { user: SessionUser; me: PersonRecord; params: MeParams }) {
  const isMaster = user.systemRole === 'master';
  const people = isMaster
    ? (await adminDb.collection('people').get()).docs.map((d) => toPerson(d)!).filter((p) => p.personId !== user.personId)
    : await listDescendants(user.personId);
  // Scope above is the server's; category / sort / view below only arrange what's in scope.
  const cat = parseCategory(params.pcat);
  const sortKey = ME_SORTS.find(([v]) => v === params.psort)?.[0] ?? 'tree';
  const display = parseView(params.pview);
  const codeOf = (p: PersonRecord) => accessCodeFor(p.profileType, p.accessNumber) ?? '';
  const counts = countByCategory(people);
  const inCat = people.filter((p) => cat === 'all' || categoryOf(p) === cat);
  const arranged = sortKey === 'tree'
    ? inCat.sort((a, b) => a.ancestorIds.length - b.ancestorIds.length || a.firstName.localeCompare(b.firstName))
    : sortPeople(inCat, sortKey, codeOf);
  const view = paginate(arranged, parsePage(params.people));
  const keep = { pcat: params.pcat, psort: params.psort, pview: params.pview };
  const usedCats = CATEGORIES.filter(([c]) => c === 'all' || counts[c] > 0).map(([v, l]) => [v, l, counts[v]] as const);
  const [queue, ents] = await Promise.all([
    listApprovalQueue(user, { self: me, descendantIds: people.map((p) => p.personId) }),
    currentEntitlementsFor(view.items.map((p) => p.personId)), // just the people on this page
  ]);
  const today = todayDateString();
  const nameOf = new Map(people.map((p) => [p.personId, `${p.firstName} ${p.lastName}`]));
  const pendingByPerson = new Map(queue.map((r) => [r.personId, r]));
  const pendingRegistrations = people.filter((p) => p.registrationStatus === 'PENDING');

  return (
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
                {p.profileType && <RegistrationDecision personId={p.personId} name={`${p.firstName} ${p.lastName}`} status={p.registrationStatus} appliedAs={p.profileType} options={approveOptions(user)} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      {people.length > 0 && (
        <div className="space-y-2 rounded-lg border border-[#D5DDE4] bg-white p-3">
          {usedCats.length > 2 && <Chips label="Show" param="pcat" path="/me" params={keep} current={cat} options={usedCats} pageParam="people" />}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Chips label="Sort" param="psort" path="/me" params={keep} current={sortKey} options={ME_SORTS} pageParam="people" />
            <Chips label="View" param="pview" path="/me" params={keep} current={display} options={VIEWS} pageParam="people" />
          </div>
        </div>
      )}

      {people.length === 0 ? (
        <p className="text-sm text-[#7C8C9B]">Nobody here yet.</p>
      ) : display === 'cards' ? (
        <>
          <CardGrid>
            {view.items.map((p) => {
              const ent = ents.get(p.personId) ?? null;
              const status = p.systemRole === 'guard' ? 'GUARD' : accessStatus(p, ent ? effectiveStatus(ent, today) : null);
              return (
                <PersonCard key={p.personId}
                  p={{ personId: p.personId, firstName: p.firstName, lastName: p.lastName, username: p.username, category: categoryOf(p),
                    typeLabel: p.systemRole === 'master' ? 'Master' : p.profileType ? PROFILE_LABEL[p.profileType] : 'Guard',
                    code: codeOf(p) || null, status, lastEntry: lastEntryMillis(p) ? formatDateTime(new Date(lastEntryMillis(p))) : null,
                    under: p.parentId ? nameOf.get(p.parentId) ?? (p.parentId === me.personId ? 'me' : null) : null }}
                  footer={(pendingByPerson.has(p.personId) || (p.profileType && (status === 'NONE' || status === 'EXPIRED'))) ? (
                    pendingByPerson.has(p.personId)
                      ? <span className="text-xs font-semibold text-amber-700">Request pending</span>
                      : <GrantButton personId={p.personId} name={`${p.firstName} ${p.lastName}`} summary={usualAccess(p.profileType!, today)} />
                  ) : undefined} />
              );
            })}
          </CardGrid>
          <Pager page={view.page} pages={view.pages} total={view.total} param="people" noun="people" />
        </>
      ) : (
        <>
          <ul className="divide-y divide-[#D5DDE4]" data-testid="people-list">
            {view.items.map((p) => {
              const ent = ents.get(p.personId) ?? null;
              const status = p.systemRole === 'guard' ? 'GUARD' : accessStatus(p, ent ? effectiveStatus(ent, today) : null);
              const depth = sortKey !== 'tree' ? 0 : Math.min(3, Math.max(0, p.ancestorIds.length - (isMaster ? 0 : me.ancestorIds.length + 1)));
              return (
                <li key={p.personId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2 text-sm" style={{ paddingLeft: depth * 12 }} data-person={p.username}>
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="truncate font-medium">{p.firstName} {p.lastName} <span className="font-normal text-[#7C8C9B]">@{p.username}</span></p>
                    <p className="text-xs text-[#7C8C9B]">
                      {p.systemRole === 'master' ? 'Master · ' : ''}{p.profileType ? PROFILE_LABEL[p.profileType] : 'Guard'}
                      {accessCodeFor(p.profileType, p.accessNumber) && <> · <span className="font-mono">{accessCodeFor(p.profileType, p.accessNumber)}</span></>}
                      {pendingByPerson.has(p.personId) && <span className="font-semibold text-amber-700"> · request pending</span>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.profileType && (status === 'NONE' || status === 'EXPIRED') && !pendingByPerson.has(p.personId) && (
                      <GrantButton personId={p.personId} name={`${p.firstName} ${p.lastName}`} summary={usualAccess(p.profileType, today)} />
                    )}
                    <Pill status={status} />
                  </div>
                </li>
              );
            })}
          </ul>
          <Pager page={view.page} pages={view.pages} total={view.total} param="people" noun="people" />
        </>
      )}
    </Section>
  );
}

export default async function MePage({ searchParams }: { searchParams: Promise<MeParams> }) {
  const user = await requirePageRole('member', 'master');
  const params = await searchParams;
  const isMaster = user.systemRole === 'master';

  const [me, current, myRequests] = await Promise.all([
    loadPerson(user.personId),
    getCurrentEntitlement(user.personId),
    listRequestsFor(user.personId),
  ]);
  if (!me) redirect('/login');

  const today = todayDateString();
  const canManage = isMaster || (me.profileType === 'employee' && me.registrationStatus === 'APPROVED' && me.active);
  const myEffective = current ? effectiveStatus(current, today) : null;
  const myStatus = accessStatus(me, myEffective);
  const period = current && myEffective !== 'SUPERSEDED' ? current : null;
  const pending = myRequests.find((r) => r.status === 'PENDING');
  const requestsView = paginate(myRequests, parsePage(params.requests), MY_REQUESTS_PER_PAGE);
  const name = `${me.firstName} ${me.lastName}`;
  const photo = typeof me.photoDataUrl === 'string' ? me.photoDataUrl : null;
  const rawNotice = me.approvalNotice as { appliedAs?: unknown; approvedAs?: unknown; seenAt?: unknown } | undefined;
  const notice = rawNotice && !rawNotice.seenAt && isProfileType(rawNotice.appliedAs) && isProfileType(rawNotice.approvedAs)
    ? { appliedAs: rawNotice.appliedAs, approvedAs: rawNotice.approvedAs } : null;

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 text-[#1B2A38]">
      <RoleHeader role={user.systemRole} subtitle={me.username} />

      <div className="flex flex-wrap items-center gap-3">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- data: URL from the person doc
          <img src={photo} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#DCEAF1] font-semibold text-[#0D5B7A]">{me.firstName[0]}{me.lastName[0]}</div>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{name}</h1>
          <p className="text-sm text-[#46596B]">{me.profileType ? PROFILE_LABEL[me.profileType] : '—'}</p>
        </div>
        {isMaster && <Link href="/admin" className="inline-flex min-h-10 items-center md:min-h-0 ml-auto text-sm font-medium text-[#0D5B7A] underline">Admin dashboard →</Link>}
      </div>
      <DataStamp fetchedAt={fetchedAtNow()} pageParams={['people', 'requests']} />
      {notice && (
        <ApprovalNotice appliedAs={PROFILE_LABEL[notice.appliedAs]} approvedAs={PROFILE_LABEL[notice.approvedAs]}
          code={accessCodeFor(me.profileType, me.accessNumber)} access={period ? windowSummary(period) : null} />
      )}

      <Section title="Profile" id="profile">
        <dl>
          <Row label="Name" value={name} />
          <Row label="Username" value={<span className="font-mono">{me.username}</span>} />
          <Row label="EDC email" value={typeof me.edcEmail === 'string' && me.edcEmail ? me.edcEmail : <span className="text-[#7C8C9B]">not assigned</span>} />
          <Row label="Communication email" value={<span className="break-all">{String(me.commEmail ?? '—')}</span>} />
          <Row label="Mobile" value={String(me.mobile ?? '—')} />
          <Row label="Profile type" value={me.profileType ? PROFILE_LABEL[me.profileType] : '—'} />
          <Row label="Registration" value={<Pill status={me.registrationStatus} />} />
        </dl>
        <AccountSettings
          username={me.username}
          initial={{ firstName: me.firstName, lastName: me.lastName, mobile: String(me.mobile ?? ''), purpose: String(me.purpose ?? '') }}
        />
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
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Link href="/me/pass" className="inline-flex min-h-10 items-center rounded bg-[#0D5B7A] px-4 text-sm font-semibold text-white">Open my entry pass</Link>
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
          <>
            <ul className="divide-y divide-[#D5DDE4]" data-testid="my-requests">
              {requestsView.items.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="break-words font-medium">{r.purpose}</p>
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
            <Pager page={requestsView.page} pages={requestsView.pages} total={requestsView.total} param="requests" noun="requests" />
          </>
        )}
      </Section>

      {canManage && (
        <Suspense fallback={<Section title={isMaster ? 'Everyone' : 'People under me'} id="people"><SkeletonBlock className="h-10 w-48" /><SkeletonBlock className="h-40 w-full" /></Section>}>
          <PeopleSection user={user} me={me} params={params} />
        </Suspense>
      )}
    </main>
  );
}

function usualAccess(type: NonNullable<PersonRecord['profileType']>, today: string): string {
  return `${PROFILE_LABEL[type]} default: ${windowSummary(templateWindow(type, today))}`;
}
