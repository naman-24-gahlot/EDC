import type { ReactNode } from 'react';
import { requirePageRole } from '@/lib/session';

// Every page under /me is for a person with a profile: members and Masters. Guards have
// no pass. systemRole comes only from the verified session cookie.
export default async function MeLayout({ children }: { children: ReactNode }) {
  await requirePageRole('member', 'master'); // also routes ended sessions and pending password changes
  return <div className="min-h-screen bg-[#E8EDF1]">{children}</div>;
}
