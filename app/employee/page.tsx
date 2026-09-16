import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { RoleHeader } from '@/components/RoleHeader';

// Placeholder. The old daily-request/QR logic here was built entirely around the
// `requests` collection, which the identity/hierarchy expansion drops (see
// DATABASE_SCHEMA.md). P7 rebuilds the reusable pass at /me/pass and links to it
// from here; P9 retires this route in favor of /me. This page exists only to keep
// routing and auth intact in between — see EXPANSION_PLAN.md P2 item 7.
export default async function EmployeeHomePage() {
  const user = await getSessionUser();
  if (!user || (user.systemRole !== 'member' && user.systemRole !== 'master')) {
    redirect('/login');
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <RoleHeader role="employee" subtitle={user.email ?? undefined} />
      <p className="text-sm text-gray-500">
        This area is being rebuilt as part of the identity/hierarchy expansion — profile,
        access, requests and your entry pass are coming back in the next phases.
      </p>
    </main>
  );
}
