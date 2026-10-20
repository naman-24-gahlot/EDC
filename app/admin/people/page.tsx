import Link from 'next/link';
import { todayDateString } from '@/lib/date';
import { accessCodeFor } from '@/lib/access/codes';
import { effectiveStatus } from '@/lib/access/entitlements';
import { PROFILE_LABEL, accessStatus } from '@/lib/display';
import { StatusPill } from '@/components/StatusPill';
import { allPeople, currentEntitlementByPerson, nameMap, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

export default async function AdminPeoplePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireMasterPage();
  const q = ((await searchParams).q ?? '').trim().toLowerCase();
  const [people, ents] = await Promise.all([allPeople(), currentEntitlementByPerson()]);
  const names = nameMap(people);
  const today = todayDateString();

  // Master's scope is everyone, so this search is a convenience, not an authorization filter.
  const rows = people
    .map((p) => {
      const code = accessCodeFor(p.profileType, p.accessNumber);
      const ent = ents.get(p.personId);
      const status = p.systemRole === 'guard' ? 'GUARD' : accessStatus(p, ent ? effectiveStatus(ent, today) : null);
      return { p, code, status };
    })
    .filter(({ p, code }) =>
      !q || [p.firstName, p.lastName, `${p.firstName} ${p.lastName}`, p.username, code ?? '', p.profileType ?? 'guard']
        .some((s) => s.toLowerCase().includes(q))
    )
    .sort((a, b) => a.p.firstName.localeCompare(b.p.firstName));

  return (
    <div className="space-y-4">
      <form className="flex gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search name, username, code or type" aria-label="Search people"
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm" />
        <button className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white">Search</button>
        {q && <Link href="/admin/people" className="self-center text-sm text-gray-500 underline">Clear</Link>}
      </form>
      <p className="text-xs text-gray-500">{rows.length} of {people.length} people</p>

      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-left text-sm">
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
            {rows.map(({ p, code, status }) => (
              <tr key={p.personId} data-person={p.username}>
                <td className="px-3 py-2">
                  <Link href={`/admin/people/${p.personId}`} className="font-medium hover:underline">{p.firstName} {p.lastName}</Link>
                  <span className="ml-1 text-xs text-gray-400">@{p.username}</span>
                  {p.systemRole === 'master' && <span className="ml-2"><StatusPill status="MASTER" /></span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{code ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{p.profileType ? PROFILE_LABEL[p.profileType] : 'Guard'}</td>
                <td className="px-3 py-2 text-xs">{p.parentId ? names.get(p.parentId) ?? p.parentId : '—'}</td>
                <td className="px-3 py-2"><StatusPill status={status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
