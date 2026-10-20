import Link from 'next/link';
import { StatusPill } from '@/components/StatusPill';
import { allPeople } from '../data';
import { CreateGuardForm } from './CreateGuardForm';

export const dynamic = 'force-dynamic';

export default async function AdminGuardsPage() {
  const guards = (await allPeople()).filter((p) => p.systemRole === 'guard').sort((a, b) => a.firstName.localeCompare(b.firstName));

  return (
    <div className="space-y-4">
      <CreateGuardForm />
      <h2 className="text-sm font-medium text-gray-500">Guards ({guards.length})</h2>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200">
        {guards.map((g) => (
          <li key={g.personId} className="flex items-center justify-between px-3 py-2 text-sm" data-guard={g.username}>
            <span><Link href={`/admin/people/${g.personId}`} className="font-medium hover:underline">{g.firstName} {g.lastName}</Link> <span className="text-xs text-gray-400">@{g.username}</span></span>
            <StatusPill status={g.active ? 'ACTIVE' : 'DEACTIVATED'} />
          </li>
        ))}
      </ul>
    </div>
  );
}
