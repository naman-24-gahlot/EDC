import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { RoleHeader } from '@/components/RoleHeader';
import { AdminNav } from './AdminNav';

// Server-side route protection: every page under /admin is gated here.
// systemRole comes only from the verified session cookie — never trust the client.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.systemRole !== 'master') redirect('/login');

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <RoleHeader role="admin" subtitle={user.email ?? undefined} />
      <AdminNav />
      <div className="pt-6">{children}</div>
    </div>
  );
}
