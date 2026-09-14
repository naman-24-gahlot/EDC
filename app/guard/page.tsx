import { getSessionUser } from '@/lib/session';
import { RoleHeader } from '@/components/RoleHeader';
import { GuardScanner } from './GuardScanner';

export default async function GuardHomePage() {
  const user = await getSessionUser();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <RoleHeader role="guard" subtitle={user?.email ?? undefined} />
      <GuardScanner />
    </main>
  );
}
