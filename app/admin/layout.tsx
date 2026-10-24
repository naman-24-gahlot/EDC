import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { requirePageRole } from '@/lib/session';
import { pendingCounts } from './data';
import { RoleHeader } from '@/components/RoleHeader';
import { AdminNav } from './AdminNav';

// The nav renders at once; its waiting-count badges stream in, so no admin page waits on them.
async function NavWithCounts() {
  return <AdminNav counts={await pendingCounts()} />;
}

// Server-side route protection: every page under /admin is gated here.
// systemRole comes only from the verified session cookie — never trust the client.
// (Each admin page ALSO checks Master itself — a layout alone can be skipped; see app/admin/data.ts.)
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requirePageRole('master'); // also routes ended sessions and pending password changes

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8">
      <RoleHeader role="master" subtitle={user.email ?? undefined} />
      <p className="-mt-3 mb-3 text-right text-xs sm:-mt-4 sm:mb-4"><Link href="/admin/outbox" className="mr-4 inline-flex min-h-10 items-center text-gray-400 underline md:min-h-0">Emails sent</Link><Link href="/me" className="inline-flex min-h-10 items-center md:min-h-0 text-gray-500 underline">My own account →</Link></p>
      <Suspense fallback={<AdminNav counts={{ requests: 0, registrations: 0, stays: 0, leave: 0 }} />}>
        <NavWithCounts />
      </Suspense>
      <div className="pt-5 sm:pt-6">{children}</div>
    </div>
  );
}
