import { requirePageRole } from '@/lib/session';
import { onCampusNow } from '@/lib/gate';
import { fetchedAtNow } from '@/lib/paging';
import { RoleHeader } from '@/components/RoleHeader';
import { DataStamp } from '@/components/DataStamp';
import { OnCampusPanel } from '@/components/OnCampusPanel';
import { GuardScanner } from './GuardScanner';

export const dynamic = 'force-dynamic';

export default async function GuardHomePage() {
  const user = await requirePageRole('guard');
  const people = await onCampusNow();

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-8">
      <RoleHeader role="guard" subtitle={user.email ?? undefined} />
      <GuardScanner />
      <div className="space-y-2">
        <DataStamp fetchedAt={fetchedAtNow()} />
        <OnCampusPanel people={people} />
      </div>
    </main>
  );
}
