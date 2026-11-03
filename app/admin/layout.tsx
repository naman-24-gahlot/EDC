import type { ReactNode } from 'react';
import { requirePageRole } from '@/lib/session';
import { pendingCounts } from './data';
import { AppShell } from '@/components/shell/AppShell';
import { TestModeBar } from './TestModeBar';
import { testModeOn } from '@/lib/testMode';

// Server-side route protection: every page under /admin is gated here.
// systemRole comes only from the verified session cookie — never trust the client.
// (Each admin page ALSO checks Master itself — a layout alone can be skipped; see app/admin/data.ts.)
// The frame (sidebar, header) is components/shell/AppShell.tsx; the waiting-count badges stream in,
// so no admin page waits on them.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePageRole('master'); // also routes ended sessions and pending password changes
  const counts = pendingCounts().catch(() => null);
  return (
    <AppShell area="admin" role="master" user={{ name: user.email?.split('@')[0] ?? 'Master', email: user.email }} counts={counts}>
      <TestModeBar on={await testModeOn({ fresh: true })} />
      {children}
    </AppShell>
  );
}
