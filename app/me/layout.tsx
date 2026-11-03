import type { ReactNode } from 'react';
import { requirePageRole } from '@/lib/session';
import { AppShell } from '@/components/shell/AppShell';

// Every page under /me is for a person with a profile: members and Masters. Guards have
// no pass. systemRole comes only from the verified session cookie.
export default async function MeLayout({ children }: { children: ReactNode }) {
  const user = await requirePageRole('member', 'master'); // also routes ended sessions and pending password changes
  return (
    <AppShell area="member" role={user.systemRole === 'master' ? 'master' : 'member'} user={{ name: user.email?.split('@')[0] ?? 'Me', email: user.email }}>
      {children}
    </AppShell>
  );
}
