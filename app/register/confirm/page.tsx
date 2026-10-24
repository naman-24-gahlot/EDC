import Link from 'next/link';
import { HttpError } from '@/lib/hierarchy/authorize';
import { confirmEmailCheck, CONFIRMED_FOR_MS } from '@/lib/emailCheck';

export const dynamic = 'force-dynamic';

async function confirm(params: { email?: string; oobCode?: string; token?: string }) {
  try { return { ok: true as const, email: await confirmEmailCheck(params) }; }
  catch (err) { return { ok: false as const, error: err instanceof HttpError ? err.message : 'Something went wrong with this link.' }; }
}

// Opened from the "confirm your email" link. Confirms the address for the registration form,
// which is usually still open in another tab and notices within a few seconds.
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ email?: string; oobCode?: string; token?: string }> }) {
  const r = await confirm(await searchParams);
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-3 rounded-lg border border-gray-200 p-6" role="status">
        {r.ok ? (
          <>
            <h1 className="text-lg font-semibold text-emerald-800">✓ Email confirmed</h1>
            <p className="text-sm text-gray-600"><b className="break-all">{r.email}</b> is confirmed for the next {CONFIRMED_FOR_MS / 3_600_000} hours.</p>
            <p className="text-sm text-gray-600">Go back to the registration form — it updates by itself — and submit. If you closed it, <Link href="/register" className="underline">open the form again</Link> and use the same email.</p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">This link didn’t work</h1>
            <p className="text-sm text-gray-600">{r.error}</p>
            <Link href="/register" className="inline-flex min-h-10 items-center text-sm underline">Back to registration</Link>
          </>
        )}
      </div>
    </main>
  );
}
