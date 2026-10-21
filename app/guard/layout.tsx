import type { ReactNode } from 'react';
import { requirePageRole } from '@/lib/session';

// Server-side route protection: every page under /guard is gated here.
// systemRole comes only from the verified session cookie — never trust the client.
export default async function GuardLayout({ children }: { children: ReactNode }) {
  await requirePageRole('guard'); // also routes ended sessions and pending password changes
  return <>{children}</>;
}
