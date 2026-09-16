import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

// Server-side route protection: every page under /employee is gated here.
// systemRole comes only from the verified session cookie — never trust the client.
// Master may also reach here (system-wide access); P9 moves this area to /me.
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.systemRole !== 'member' && user.systemRole !== 'master') redirect('/login');
  return <>{children}</>;
}
