import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

// Every page under /me is for a person with a profile: members and Masters. Guards have
// no pass. systemRole comes only from the verified session cookie.
export default async function MeLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user || (user.systemRole !== 'member' && user.systemRole !== 'master')) redirect('/login');
  return <div className="min-h-screen bg-[#E8EDF1]">{children}</div>;
}
