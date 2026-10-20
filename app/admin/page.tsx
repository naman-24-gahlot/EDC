import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { expireStaleRequests, type AccessRequest } from '@/lib/access/requests';
import { PROFILE_LABEL, formatDate, formatDateTime } from '@/lib/display';
import { DecisionButtons } from '@/components/DecisionButtons';
import { StatusPill } from '@/components/StatusPill';
import { allPeople, nameMap, requireMasterPage } from './data';

export const dynamic = 'force-dynamic';

export default async function AdminRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireMasterPage();
  const { status: filter } = await searchParams;
  const [snap, people] = await Promise.all([adminDb.collection('accessRequests').get(), allPeople()]);
  const raw = snap.docs.map((d) => ({ ...(d.data() as Omit<AccessRequest, 'id'>), id: d.id }));
  const requests = await expireStaleRequests(raw);
  const byId = new Map(people.map((p) => [p.personId, p]));
  const names = nameMap(people);

  const shown = requests
    .filter((r) => !filter || filter === 'ALL' || r.status === filter)
    .sort((a, b) =>
      a.status === 'PENDING' && b.status === 'PENDING' ? a.actionableUntil.toMillis() - b.actionableUntil.toMillis()
        : a.status === 'PENDING' ? -1 : b.status === 'PENDING' ? 1
        : b.createdAt.toMillis() - a.createdAt.toMillis()
    );
  const counts = requests.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'].map((s) => (
          <Link key={s} href={s === 'ALL' ? '/admin' : `/admin?status=${s}`}
            className={`rounded-full px-3 py-1 font-semibold ${(filter ?? 'ALL') === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {s} ({s === 'ALL' ? requests.length : counts[s] ?? 0})
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-gray-400">No requests.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
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
                const p = byId.get(r.personId);
                return (
                  <tr key={r.id} data-request={r.id}>
                    <td className="px-3 py-2">
                      <Link href={`/admin/people/${r.personId}`} className="font-medium underline-offset-2 hover:underline">{names.get(r.personId) ?? r.personId}</Link>
                      <p className="text-xs text-gray-500">{p?.profileType ? PROFILE_LABEL[p.profileType] : '—'}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.requestedBy === r.personId ? 'self' : names.get(r.requestedBy) ?? r.requestedBy}</td>
                    <td className="px-3 py-2 text-xs">{p?.parentId ? names.get(p.parentId) : 'Master'}</td>
                    <td className="px-3 py-2 text-xs">
                      <p className="text-sm">{r.purpose}</p>
                      <p className="text-gray-500">
                        {r.requestedStartDate ? formatDate(r.requestedStartDate) : 'template'}{r.requestedEndDate ? ` → ${formatDate(r.requestedEndDate)}` : ''}
                      </p>
                    </td>
                    <td className="px-3 py-2"><StatusPill status={r.status} /></td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{formatDateTime(r.actionableUntil.toDate())}</td>
                    <td className="px-3 py-2">
                      {r.status === 'PENDING' && <DecisionButtons base={`/api/requests/${r.id}`} what={`request for ${names.get(r.personId)}`} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
