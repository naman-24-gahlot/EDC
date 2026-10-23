import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { formatDateTime } from '@/lib/display';
import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

const KIND = { resetPassword: 'Password reset', verifyEmail: 'Confirm email' } as const;

// Emails for test addresses (…@anything.test) are never sent — they land here instead, so
// sign-up, verification and forgot-password can be tested without real inboxes.
export default async function TestOutboxPage() {
  await requireMasterPage();
  const snap = await adminDb.collection('testOutbox').orderBy('createdAt', 'desc').limit(50).get();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Test outbox — the latest 50</h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      <p className="text-sm text-gray-600">
        Register with any address ending in <code className="rounded bg-gray-100 px-1">.test</code> (e.g. <code className="rounded bg-gray-100 px-1">qa1@example.test</code>) and the
        emails it would get appear here instead of being sent. Real addresses get real emails.
      </p>
      {snap.empty ? <p className="text-sm text-gray-400">Nothing yet.</p> : (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
          {snap.docs.map((d) => { const m = d.data(); return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" data-outbox={m.to}>
              <span className="min-w-0"><b>{KIND[m.kind as keyof typeof KIND] ?? m.kind}</b> → <span className="break-all">{m.to}</span>
                <span className="block text-xs text-gray-500">{formatDateTime(m.createdAt.toDate())}</span></span>
              <Link href={m.link} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-xs font-medium md:min-h-8">Open link</Link>
            </li>
          ); })}
        </ul>
      )}
    </div>
  );
}
