import Link from 'next/link';
import { adminDb } from '@/lib/firebase/admin';
import { formatDateTime } from '@/lib/display';
import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { mailConfigured } from '@/lib/mail';
import { requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = {
  resetPassword: 'Password reset', verifyEmail: 'Confirm email', confirmEmail: 'Confirm email (before registering)',
  REGISTRATION_APPROVED: 'Registration approved', REGISTRATION_REJECTED: 'Registration not approved', ACCESS_APPROVED: 'Access approved',
  VISITOR_PASS: 'Visitor pass', VISITOR_ARRIVED: 'VVIP visitor arrived', STAY_ALERT: 'Stay alert', LEAVE_DECIDED: 'Leave decided',
  PASSWORD_RESET_BACKUP: 'Password reset (backup email)',
};
const STATUS: Record<string, string> = { sent: 'text-emerald-700', outbox: 'text-sky-700', skipped: 'text-amber-700', failed: 'text-red-700' };

// Two lists: (1) the test outbox — emails for test addresses (…@anything.test) are never sent and
// land here, so flows can be tested without real inboxes; (2) the delivery log of the app's own
// emails (lib/mail.ts): what was sent, skipped (email sending not set up) or failed. Firebase's own
// emails (password reset, confirm email) aren't in the log — Firebase sends those.
export default async function EmailsPage() {
  await requireMasterPage();
  const [outbox, log] = await Promise.all([
    adminDb.collection('testOutbox').orderBy('createdAt', 'desc').limit(50).get(),
    adminDb.collection('emailLog').orderBy('at', 'desc').limit(50).get(),
  ]);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">Emails</h2>
        <DataStamp fetchedAt={fetchedAtNow()} />
      </div>
      {!mailConfigured() && (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="mail-off">
          Sending the app’s own emails (approval summaries, visitor passes, stay alerts, backup-email resets) isn’t set up yet, so emails to real addresses are <b>skipped</b>. See DEPLOYMENT.md “Emails” — it needs a Gmail address and an app password in two environment variables.
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Test outbox — the latest 50</h3>
        <p className="text-sm text-gray-600">
          Register with any address ending in <code className="rounded bg-gray-100 px-1">.test</code> (e.g. <code className="rounded bg-gray-100 px-1">qa1@example.test</code>) and the
          emails it would get appear here instead of being sent.
        </p>
        {outbox.empty ? <p className="text-sm text-gray-400">Nothing yet.</p> : (
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
            {outbox.docs.map((d) => { const m = d.data(); return (
              <li key={d.id} className="space-y-1 px-3 py-2" data-outbox={m.to}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0"><b>{KIND[m.kind] ?? m.kind}</b> → <span className="break-all">{m.to}</span>
                    <span className="block text-xs text-gray-500">{formatDateTime(m.createdAt.toDate())}{m.subject ? ` · ${m.subject}` : ''}</span></span>
                  {m.link && <Link href={m.link} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-xs font-medium md:min-h-8">Open link</Link>}
                </div>
                {m.text && (
                  <details><summary className="cursor-pointer text-xs text-gray-500">Show the email</summary>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-50 p-2 text-xs" data-testid="outbox-text">{m.text}</pre></details>
                )}
              </li>
            ); })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Delivery log — the latest 50</h3>
        {log.empty ? <p className="text-sm text-gray-400">Nothing yet.</p> : (
          <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm" data-testid="email-log">
            {log.docs.map((d) => { const m = d.data(); return (
              <li key={d.id} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                <span className="min-w-0"><b>{KIND[m.kind] ?? m.kind}</b> → <span className="break-all">{m.to}</span>
                  <span className="block text-xs text-gray-500">{formatDateTime(m.at.toDate())} · {m.subject}{m.error ? ` · ${m.error}` : ''}</span></span>
                <span className={`text-xs font-semibold ${STATUS[m.status] ?? ''}`}>{m.status === 'outbox' ? 'test outbox' : m.status}</span>
              </li>
            ); })}
          </ul>
        )}
      </section>
    </div>
  );
}
