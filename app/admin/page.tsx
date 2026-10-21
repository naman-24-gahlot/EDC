import Link from 'next/link';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { expireStaleRequests, type AccessRequest } from '@/lib/access/requests';
import { PROFILE_LABEL, formatDate, formatDateTime } from '@/lib/display';
import { PAGE_SIZE, fetchedAtNow, parsePage } from '@/lib/paging';
import { DecisionButtons } from '@/components/DecisionButtons';
import { StatusPill } from '@/components/StatusPill';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { namesFor, requireMasterPage } from './data';

export const dynamic = 'force-dynamic';

const DECIDED = ['APPROVED', 'REJECTED', 'EXPIRED'] as const;
type Filter = 'ALL' | 'PENDING' | (typeof DECIDED)[number];
const FILTERS: Filter[] = ['ALL', 'PENDING', ...DECIDED];

const toRequest = (d: DocumentSnapshot) => ({ ...(d.data() as Omit<AccessRequest, 'id'>), id: d.id });

export default async function AdminRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  await requireMasterPage();
  const params = await searchParams;
  const filter: Filter = FILTERS.includes(params.status as Filter) ? (params.status as Filter) : 'ALL';
  const page = parsePage(params.page);
  const requests = adminDb.collection('accessRequests');

  // Pending requests are few and must all be read to expire stale ones; decided ones are only
  // ever counted and paged — so this page's reads don't grow with the whole history.
  const [pendingSnap, ...counts] = await Promise.all([
    requests.where('status', '==', 'PENDING').get(),
    ...DECIDED.map((s) => requests.where('status', '==', s).count().get()),
  ]);
  const pendingAll = (await expireStaleRequests(pendingSnap.docs.map(toRequest)));
  const justExpired = pendingAll.filter((r) => r.status === 'EXPIRED').length;
  const pending = pendingAll.filter((r) => r.status === 'PENDING').sort((a, b) => a.actionableUntil.toMillis() - b.actionableUntil.toMillis());
  const decidedCount = Object.fromEntries(DECIDED.map((s, i) => [s, counts[i].data().count + (s === 'EXPIRED' ? justExpired : 0)])) as Record<(typeof DECIDED)[number], number>;
  const tabCount: Record<Filter, number> = { ALL: pending.length + DECIDED.reduce((n, s) => n + decidedCount[s], 0), PENDING: pending.length, ...decidedCount };

  // The page: pending first (soonest deadline first), then decided newest first.
  const start = (page - 1) * PAGE_SIZE;
  let shown: AccessRequest[] = [];
  if (filter === 'PENDING' || filter === 'ALL') shown = pending.slice(start, start + PAGE_SIZE);
  if (filter !== 'PENDING' && shown.length < PAGE_SIZE) {
    const decidedOffset = Math.max(0, start - (filter === 'ALL' ? pending.length : 0));
    const q = filter === 'ALL' ? requests.where('status', 'in', [...DECIDED]) : requests.where('status', '==', filter);
    const snap = await q.orderBy('createdAt', 'desc').offset(decidedOffset).limit(PAGE_SIZE - shown.length).get();
    shown = [...shown, ...snap.docs.map(toRequest)];
  }
  const total = tabCount[filter];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Only the people on screen: their type and controller, plus requester and controller names.
  const personIds = [...new Set(shown.map((r) => r.personId))];
  const personSnaps = personIds.length
    ? await adminDb.getAll(...personIds.map((id) => adminDb.collection('people').doc(id)), { fieldMask: ['firstName', 'lastName', 'profileType', 'parentId'] })
    : [];
  const persons = new Map(personSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as { firstName: string; lastName: string; profileType: keyof typeof PROFILE_LABEL | null; parentId: string | null }]));
  const names = await namesFor([...shown.map((r) => r.requestedBy), ...[...persons.values()].map((p) => p.parentId)]);
  for (const [id, p] of persons) names.set(id, `${p.firstName} ${p.lastName}`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {FILTERS.map((s) => (
          <Link key={s} href={s === 'ALL' ? '/admin' : `/admin?status=${s}`}
            className={`inline-flex min-h-9 items-center rounded-full px-3 font-semibold ${filter === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {s} ({tabCount[s]})
          </Link>
        ))}
      </div>
      <DataStamp fetchedAt={fetchedAtNow()} />

      {shown.length === 0 ? (
        <p className="text-sm text-gray-400">No requests.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="rtable w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Requested by</th>
                <th className="px-3 py-2">Controller</th>
                <th className="px-3 py-2">Purpose / period</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actionable until</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {shown.map((r) => {
                const p = persons.get(r.personId);
                return (
                  <tr key={r.id} data-request={r.id}>
                    <td data-label="" className="px-3 py-2">
                      <Link href={`/admin/people/${r.personId}`} className="font-medium underline-offset-2 hover:underline">{names.get(r.personId) ?? r.personId}</Link>
                      <span className="ml-1 text-xs text-gray-500 md:ml-0 md:block">{p?.profileType ? PROFILE_LABEL[p.profileType] : '—'}</span>
                    </td>
                    <td data-label="Requested by" className="px-3 py-2 text-xs">{r.requestedBy === r.personId ? 'self' : names.get(r.requestedBy) ?? r.requestedBy}</td>
                    <td data-label="Controller" className="px-3 py-2 text-xs">{p?.parentId ? names.get(p.parentId) : 'Master'}</td>
                    <td data-label="Purpose" className="px-3 py-2 text-xs">
                      <span className="block text-sm">{r.purpose}</span>
                      <span className="block text-gray-500">
                        {r.requestedStartDate ? formatDate(r.requestedStartDate) : 'template'}{r.requestedEndDate ? ` → ${formatDate(r.requestedEndDate)}` : ''}
                      </span>
                    </td>
                    <td data-label="Status" className="px-3 py-2"><StatusPill status={r.status} /></td>
                    <td data-label="Until" className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{formatDateTime(r.actionableUntil.toDate())}</td>
                    <td data-label="" className="px-3 py-2">
                      {r.status === 'PENDING' && <DecisionButtons base={`/api/requests/${r.id}`} what={`request for ${names.get(r.personId)}`} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={Math.min(page, pages)} pages={pages} total={total} noun="requests" />
    </div>
  );
}
