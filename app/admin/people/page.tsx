import Link from 'next/link';
import { todayDateString } from '@/lib/date';
import { accessCodeFor } from '@/lib/access/codes';
import { currentEntitlementsFor, effectiveStatus } from '@/lib/access/entitlements';
import { PROFILE_LABEL, accessStatus } from '@/lib/display';
import { fetchedAtNow, paginate, parsePage } from '@/lib/paging';
import { StatusPill } from '@/components/StatusPill';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { allPeople, nameMap, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

export default async function AdminPeoplePage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireMasterPage();
  const params = await searchParams;
  const q = (params.q ?? '').trim().toLowerCase().slice(0, 100);
  const people = await allPeople();
  const names = nameMap(people);

  // Master's scope is everyone, so this search is a convenience, not an authorization filter.
  const matching = people
    .filter((p) => {
      const code = accessCodeFor(p.profileType, p.accessNumber) ?? '';
      return !q || [p.firstName, p.lastName, `${p.firstName} ${p.lastName}`, p.username, code, p.profileType ?? 'guard'].some((s) => s.toLowerCase().includes(q));
    })
    .sort((a, b) => a.firstName.localeCompare(b.firstName));
  const view = paginate(matching, parsePage(params.page));
  // Access status only for the rows on screen.
  const ents = await currentEntitlementsFor(view.items.map((p) => p.personId));
  const today = todayDateString();

  return (
    <div className="space-y-4">
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, username, code or type" aria-label="Search people"
          className="min-w-0 flex-1 basis-48 rounded border border-gray-300 px-3 py-2 text-sm" />
        <button className="min-h-10 rounded bg-gray-900 px-4 text-sm font-medium text-white">Search</button>
        {q && <Link href="/admin/people" className="self-center text-sm text-gray-500 underline">Clear</Link>}
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">{matching.length} of {people.length} people</p>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="rtable w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Parent</th>
              <th className="px-3 py-2">Access</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {view.items.map((p) => {
              const ent = ents.get(p.personId);
              const status = p.systemRole === 'guard' ? 'GUARD' : accessStatus(p, ent ? effectiveStatus(ent, today) : null);
              return (
                <tr key={p.personId} data-person={p.username}>
                  <td data-label="" className="px-3 py-2">
                    <Link href={`/admin/people/${p.personId}`} className="font-medium hover:underline">{p.firstName} {p.lastName}</Link>
                    <span className="ml-1 text-xs text-gray-400">@{p.username}</span>
                    {p.systemRole === 'master' && <span className="ml-2"><StatusPill status="MASTER" /></span>}
                  </td>
                  <td data-label="Code" className="px-3 py-2 font-mono text-xs">{accessCodeFor(p.profileType, p.accessNumber) ?? '—'}</td>
                  <td data-label="Type" className="px-3 py-2 text-xs">{p.profileType ? PROFILE_LABEL[p.profileType] : 'Guard'}</td>
                  <td data-label="Parent" className="px-3 py-2 text-xs">{p.parentId ? names.get(p.parentId) ?? p.parentId : '—'}</td>
                  <td data-label="Access" className="px-3 py-2"><StatusPill status={status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={view.page} pages={view.pages} total={view.total} noun="people" />
    </div>
  );
}
