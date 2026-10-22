import Link from 'next/link';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { expireStaleRequests, type AccessRequest } from '@/lib/access/requests';
import { PROFILE_LABEL, formatDate, formatDateTime } from '@/lib/display';
import { PAGE_SIZE, fetchedAtNow, parsePage } from '@/lib/paging';
import { DecisionButtons } from '@/components/DecisionButtons';
import { DecisionTable, type DecisionRow } from '@/components/DecisionTable';
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

      <DecisionTable kind="request" headers={['Person', 'Requested by', 'Controller', 'Purpose / period', 'Status', 'Actionable until', '']}
        labels={['', 'Requested by', 'Controller', 'Purpose', 'Status', 'Until', '']}
        empty={filter === 'PENDING' ? 'No requests are waiting.' : 'No requests.'}
        rows={shown.map((r): DecisionRow => {
          const p = persons.get(r.personId);
          return {
            id: r.id,
            label: names.get(r.personId) ?? 'request',
            selectable: r.status === 'PENDING',
            cells: [
              <div key="p"><Link href={`/admin/people/${r.personId}`} className="font-medium underline-offset-2 hover:underline">{names.get(r.personId) ?? r.personId}</Link>
                <span className="ml-1 text-xs text-gray-500 md:ml-0 md:block">{p?.profileType ? PROFILE_LABEL[p.profileType] : '—'}</span></div>,
              <span key="b" className="text-xs">{r.requestedBy === r.personId ? 'self' : names.get(r.requestedBy) ?? r.requestedBy}</span>,
              <span key="c" className="text-xs">{p?.parentId ? names.get(p.parentId) : 'Master'}</span>,
              <span key="u" className="text-xs"><span className="block text-sm">{r.purpose}</span>
                <span className="block text-gray-500">{r.requestedStartDate ? formatDate(r.requestedStartDate) : 'their usual period'}{r.requestedEndDate ? ` → ${formatDate(r.requestedEndDate)}` : ''}</span></span>,
              <StatusPill key="s" status={r.status} />,
              <span key="t" className="whitespace-nowrap text-xs text-gray-500">{formatDateTime(r.actionableUntil.toDate())}</span>,
              r.status === 'PENDING' ? <DecisionButtons key="d" base={`/api/requests/${r.id}`} what={`request for ${names.get(r.personId)}`} /> : <span key="d" />,
            ],
          };
        })} />
      <Pager page={Math.min(page, pages)} pages={pages} total={total} noun="requests" />
    </div>
  );
}
