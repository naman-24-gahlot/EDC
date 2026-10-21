import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { toPerson } from '@/lib/hierarchy/authorize';
import { PROFILE_LABEL, formatDateTime } from '@/lib/display';
import { fetchedAtNow, paginate, parsePage } from '@/lib/paging';
import { StatusPill } from '@/components/StatusPill';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { RegistrationDecision } from '@/components/RegistrationDecision';
import { approveOptions } from '@/lib/people/approveRegistration';
import { namesFor, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

export default async function AdminRegistrationsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireMasterPage();
  const { page } = await searchParams;
  // Only people still waiting (or rejected) — not the whole people table.
  const snap = await adminDb.collection('people').where('registrationStatus', 'in', ['PENDING', 'REJECTED']).get();
  const open = snap.docs
    .map((d) => toPerson(d)!)
    .sort((a, b) => (a.registrationStatus === b.registrationStatus
      ? ((a.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0) - ((b.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0)
      : a.registrationStatus === 'PENDING' ? -1 : 1));
  const view = paginate(open, parsePage(page));
  const names = await namesFor(view.items.map((p) => p.parentId));
  const options = approveOptions(user);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Registrations — pending and rejected ({open.length})</h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>

      {view.items.length === 0 ? (
        <p className="text-sm text-gray-400">Nothing pending or rejected.</p>
      ) : (
        <ul className="space-y-3">
          {view.items.map((p) => {
            const createdAt = (p.createdAt as { toDate?: () => Date } | undefined)?.toDate?.();
            return (
              <li key={p.personId} className="rounded border border-gray-200 p-4" data-person={p.username}>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/admin/people/${p.personId}`} className="inline-flex min-h-10 items-center md:min-h-0 text-sm font-medium hover:underline">{p.firstName} {p.lastName}</Link>{' '}
                    <span className="text-xs text-gray-400">@{p.username}</span>
                    <p className="text-xs text-gray-500">
                      {p.profileType ? PROFILE_LABEL[p.profileType] : '—'}
                      {p.parentId && ` · under ${names.get(p.parentId) ?? p.parentId}`}
                      {createdAt && ` · registered ${formatDateTime(createdAt)}`}
                    </p>
                  </div>
                  <StatusPill status={p.registrationStatus} />
                </div>
                {p.profileType && (
                  <RegistrationDecision personId={p.personId} name={`${p.firstName} ${p.lastName}`} status={p.registrationStatus} appliedAs={p.profileType} options={options} />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pager page={view.page} pages={view.pages} total={view.total} noun="registrations" />
    </div>
  );
}
