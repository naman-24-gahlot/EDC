import Link from 'next/link';
import { HttpError } from '@/lib/hierarchy/authorize';
import { applyEmailVerification, inspectResetCode } from '@/lib/people/profile';
import { ResetForm } from './ResetForm';

export const dynamic = 'force-dynamic';

const message = (err: unknown) => (err instanceof HttpError ? err.message : 'Something went wrong with this link.');

/** What a link turned out to be — worked out first, rendered after. */
async function resolve(mode: string | undefined, oobCode: string | undefined) {
  if (mode === 'resetPassword') {
    try { return { kind: 'reset' as const, email: (await inspectResetCode(oobCode)).email }; } catch (err) { return { kind: 'reset-bad' as const, error: message(err) }; }
  }
  if (mode === 'verifyEmail') {
    try { await applyEmailVerification(oobCode); return { kind: 'verified' as const }; } catch (err) { return { kind: 'verify-bad' as const, error: message(err) }; }
  }
  return { kind: 'incomplete' as const };
}

function Box({ title, ok = false, children }: { title: string; ok?: boolean; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-gray-200 p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <div className={`text-sm ${ok ? 'text-emerald-800' : 'text-gray-600'}`}>{children}</div>
      </div>
    </main>
  );
}

// Where email links land (Firebase "action URL": DEPLOYMENT.md, and test-outbox links).
//  ?mode=resetPassword&oobCode=…  → checks the link (without using it up), then the form
//  ?mode=verifyEmail&oobCode=…    → confirms the email address
export default async function EmailActionPage({ searchParams }: { searchParams: Promise<{ mode?: string; oobCode?: string }> }) {
  const { mode, oobCode } = await searchParams;
  const r = await resolve(mode, oobCode);
  switch (r.kind) {
    case 'reset': return <ResetForm oobCode={oobCode!} email={r.email} />;
    case 'reset-bad': return <Box title="This reset link doesn’t work">{r.error} <Link href="/forgot" className="underline">Get a new link</Link></Box>;
    case 'verified': return <Box title="Email confirmed" ok>Thanks — your email address is verified. <Link href="/login" className="underline">Go to sign in</Link></Box>;
    case 'verify-bad': return <Box title="This confirmation link doesn’t work">{r.error} Sign in and use “Send the link again” on My account.</Box>;
    default: return <Box title="This link isn’t complete">Open the link exactly as it was emailed, or <Link href="/login" className="underline">go to sign in</Link>.</Box>;
  }
}
