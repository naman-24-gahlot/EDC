import { requirePageRole } from '@/lib/session';
import { onCampusSummary } from '@/lib/gate';
import { fetchedAtNow } from '@/lib/paging';
import { RoleHeader } from '@/components/RoleHeader';
import { DataStamp } from '@/components/DataStamp';
import { OnCampusPanel } from '@/components/OnCampusPanel';
import { GuardScanner } from './GuardScanner';

export const dynamic = 'force-dynamic';

export default async function GuardHomePage() {
  const user = await requirePageRole('guard');
  const summary = await onCampusSummary();

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <RoleHeader role="guard" subtitle={user.email ?? undefined} />
      <GuardScanner />
      <div className="space-y-2">
        <DataStamp fetchedAt={fetchedAtNow()} />
        <OnCampusPanel summary={summary} />
      </div>
    </main>
  );
}
