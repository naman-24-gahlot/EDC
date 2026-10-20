import Link from 'next/link';
import { accessCodeFor } from '@/lib/access/codes';
import { PROFILE_LABEL } from '@/lib/display';
import type { PersonRecord } from '@/lib/hierarchy/authorize';
import { allPeople } from '../data';

export const dynamic = 'force-dynamic';

// Built from the stored parentId/ancestorIds — the same data authorization reads — so the
// tree shows exactly who has authority over whom.
function Node({ person, kidsMap }: { person: PersonRecord; kidsMap: Map<string, PersonRecord[]> }) {
  const kids = kidsMap.get(person.personId) ?? [];
  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-x-2 py-0.5" data-node={person.username}>
        <Link href={`/admin/people/${person.personId}`} className="text-sm font-medium hover:underline">{person.firstName} {person.lastName}</Link>
        <span className="text-xs text-gray-500">
          {person.systemRole === 'master' ? 'Master · ' : ''}{person.profileType ? PROFILE_LABEL[person.profileType] : 'Guard'}
          {accessCodeFor(person.profileType, person.accessNumber) ? ` · ${accessCodeFor(person.profileType, person.accessNumber)}` : ''}
          {person.registrationStatus !== 'APPROVED' ? ` · ${person.registrationStatus}` : !person.active ? ' · deactivated' : ''}
        </span>
      </div>
      {kids.length > 0 && (
        <ul className="ml-3 border-l border-gray-200 pl-4">
          {kids.map((k) => <Node key={k.personId} person={k} kidsMap={kidsMap} />)}
        </ul>
      )}
    </li>
  );
}

export default async function AdminHierarchyPage() {
  const people = (await allPeople()).sort((a, b) => a.firstName.localeCompare(b.firstName));
  const kidsMap = new Map<string, PersonRecord[]>();
  for (const p of people) {
    if (p.parentId) kidsMap.set(p.parentId, [...(kidsMap.get(p.parentId) ?? []), p]);
  }
  const roots = people.filter((p) => !p.parentId);
  const masters = roots.filter((p) => p.systemRole === 'master');
  const guards = roots.filter((p) => p.systemRole === 'guard');
  const topLevel = roots.filter((p) => p.systemRole === 'member');

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Master</h2>
        <ul>{masters.map((p) => <Node key={p.personId} person={p} kidsMap={kidsMap} />)}</ul>
        <ul className="ml-3 border-l border-gray-200 pl-4">
          {topLevel.map((p) => <Node key={p.personId} person={p} kidsMap={kidsMap} />)}
        </ul>
      </section>
      {guards.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Guards (system role, outside the hierarchy)</h2>
          <ul>{guards.map((p) => <Node key={p.personId} person={p} kidsMap={kidsMap} />)}</ul>
        </section>
      )}
    </div>
  );
}
