import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

// Server-side route protection: every page under /guard is gated here.
// Role comes only from the verified session cookie — never trust the client.
export default async function GuardLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'guard') redirect('/login');
  return <>{children}</>;
}
