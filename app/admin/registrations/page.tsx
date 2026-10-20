import Link from 'next/link';
import { PROFILE_LABEL, formatDateTime } from '@/lib/display';
import { StatusPill } from '@/components/StatusPill';
import { RegistrationActions } from './RegistrationActions';
import { allPeople, nameMap, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

export default async function AdminRegistrationsPage() {
  await requireMasterPage();
  const people = await allPeople();
  const names = nameMap(people);
  const open = people
    .filter((p) => p.registrationStatus === 'PENDING' || p.registrationStatus === 'REJECTED')
    .sort((a, b) => (a.registrationStatus === b.registrationStatus ? 0 : a.registrationStatus === 'PENDING' ? -1 : 1));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-gray-500">Registrations — pending and rejected ({open.length})</h2>

      {open.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing pending or rejected.</p>
      ) : (
        <ul className="space-y-3">
          {open.map((p) => {
            const createdAt = (p.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
            return (
              <li key={p.personId} className="rounded border border-gray-200 p-4" data-person={p.username}>
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/admin/people/${p.personId}`} className="text-sm font-medium hover:underline">
                      {p.firstName} {p.lastName}
                    </Link>{' '}
                    <span className="text-xs text-gray-400">@{p.username}</span>
                    <p className="text-xs text-gray-500">
                      {p.profileType ? PROFILE_LABEL[p.profileType] : '—'}
                      {p.parentId && ` · under ${names.get(p.parentId) ?? p.parentId}`}
                      {createdAt && ` · registered ${formatDateTime(createdAt)}`}
                    </p>
                  </div>
                  <StatusPill status={p.registrationStatus} />
                </div>
                <RegistrationActions personId={p.personId} status={p.registrationStatus} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
