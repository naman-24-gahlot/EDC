import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { LIST_FIELDS, toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { byName, treeNode, type TreeBranch } from '@/lib/hierarchy/treeNode';
import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { allPeople, requireMasterPage } from '../data';
import { Branch } from './Branch';

export const dynamic = 'force-dynamic';

// Built from the stored parentId/ancestorIds — the same data authorization reads — so the
// tree shows exactly who has authority over whom. It opens at the top level (one read per
// top-level person); each employee's branch loads when opened. "Show everyone" reads the
// whole tree at once (one read per person), e.g. to print it.
export default async function AdminHierarchyPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  await requireMasterPage();
  const all = (await searchParams).all === '1';

  let roots: PersonRecord[];
  const kidsMap = new Map<string, PersonRecord[]>();
  if (all) {
    const people = (await allPeople()).sort(byName);
    for (const p of people) if (p.parentId) kidsMap.set(p.parentId, [...(kidsMap.get(p.parentId) ?? []), p]);
    roots = people.filter((p) => !p.parentId);
  } else {
    roots = (await adminDb.collection('people').where('parentId', '==', null).select(...LIST_FIELDS).get()).docs.map((d) => toPerson(d)!).sort(byName);
  }
  const branch = (p: PersonRecord): TreeBranch => ({ node: treeNode(p), ...(all ? { kids: (kidsMap.get(p.personId) ?? []).map(branch) } : {}) });
  const masters = roots.filter((p) => p.systemRole === 'master');
  const guards = roots.filter((p) => p.systemRole === 'guard');
  const topLevel = roots.filter((p) => p.systemRole === 'member');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          {all ? <>Everyone, fully open. <Link href="/admin/hierarchy" className="underline">Open branches one at a time</Link> (lighter).</>
            : <>Tap ▸ to see the people under someone. <Link href="/admin/hierarchy?all=1" className="underline">Show everyone</Link> (reads every person — e.g. to print the tree).</>}
        </p>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Master</h2>
        <ul>{masters.map((p) => <Branch key={p.personId} {...branch(p)} />)}</ul>
        <ul className="ml-3 border-l border-gray-200 pl-4">
          {topLevel.map((p) => <Branch key={p.personId} {...branch(p)} />)}
        </ul>
      </section>
      {guards.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Guards (system role, outside the hierarchy)</h2>
          <ul>{guards.map((p) => <Branch key={p.personId} {...branch(p)} />)}</ul>
        </section>
      )}
    </div>
  );
}
