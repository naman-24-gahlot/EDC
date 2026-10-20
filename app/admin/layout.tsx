import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { pendingCounts } from './data';
import { RoleHeader } from '@/components/RoleHeader';
import { AdminNav } from './AdminNav';

// Server-side route protection: every page under /admin is gated here.
// systemRole comes only from the verified session cookie — never trust the client.
// (Each admin page ALSO checks Master itself — a layout alone can be skipped; see app/admin/data.ts.)
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.systemRole !== 'master') redirect('/login');

  const counts = await pendingCounts();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <RoleHeader role="master" subtitle={user.email ?? undefined} />
      <p className="-mt-4 mb-4 text-right text-xs"><Link href="/me" className="text-gray-500 underline">My own account →</Link></p>
      <AdminNav counts={counts} />
      <div className="pt-6">{children}</div>
    </div>
  );
}
