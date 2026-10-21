import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';
import { adminDb } from '@/lib/firebase/admin';
import { toPerson } from '@/lib/hierarchy/authorize';
import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { requireMasterPage } from '../data';
import { CreateGuardForm } from './CreateGuardForm';

export const dynamic = 'force-dynamic';

export default async function AdminGuardsPage() {
  await requireMasterPage();
  const guards = (await adminDb.collection('people').where('systemRole', '==', 'guard').get()).docs.map((d) => toPerson(d)!).sort((a, b) => a.firstName.localeCompare(b.firstName));

  return (
    <div className="space-y-4">
      <CreateGuardForm />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Guards ({guards.length})</h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200">
        {guards.map((g) => (
          <li key={g.personId} className="flex items-center justify-between px-3 py-2 text-sm" data-guard={g.username}>
            <span><Link href={`/admin/people/${g.personId}`} className="inline-flex min-h-10 items-center md:min-h-0 font-medium hover:underline">{g.firstName} {g.lastName}</Link> <span className="text-xs text-gray-400">@{g.username}</span></span>
            <StatusPill status={g.active ? 'ACTIVE' : 'DEACTIVATED'} />
          </li>
        ))}
      </ul>
    </div>
  );
}
