import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

// Server-side route protection: every page under /employee is gated here.
// Role comes only from the verified session cookie — never trust the client.
export default async function EmployeeLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  if (user.role !== 'employee') redirect('/login');
  return <>{children}</>;
}
