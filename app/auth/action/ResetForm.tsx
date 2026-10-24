'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { PasswordField, type PasswordVerdict } from '@/components/PasswordField';
import type { StrengthContext } from '@/lib/passwordStrength';
import { RequestError, sendJson } from '@/lib/clientFetch';

export function ResetForm({ oobCode, email, ctx }: { oobCode: string; email: string; ctx: StrengthContext }) {
  const [verdict, setVerdict] = useState<PasswordVerdict>('blocked');
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = again.length > 0 && pw !== again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pw !== again) return;
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/auth/reset', { oobCode, newPassword: pw });
      setDone(true);
    } catch (err) {
      setError(err instanceof RequestError && err.noAnswer
        ? `${err.message} If it keeps failing, your new password may already be saved — try signing in with it.`
        : err instanceof Error ? err.message : 'Could not set your password.');
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      {done ? (
        <div className="w-full max-w-sm space-y-3 rounded-lg border border-gray-200 p-6" role="status">
          <h1 className="text-lg font-semibold">Password changed</h1>
          <p className="text-sm text-gray-600">You&apos;ve been signed out everywhere. Sign in with your new password.</p>
          <Link href="/login" className="inline-flex min-h-10 items-center rounded bg-gray-900 px-4 text-sm font-medium text-white">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 p-6" aria-label="Set a new password">
          <input type="text" name="username" autoComplete="username" value={ctx.username ?? ctx.email} readOnly hidden />
          <div>
            <h1 className="text-lg font-semibold">Set a new password</h1>
            <p className="text-sm text-gray-500">For the account registered to {email}.</p>
          </div>
          <PasswordField id="rs-new" label="New password" value={pw} onChange={setPw} ctx={ctx} onVerdict={setVerdict} />
          <div className="space-y-1">
            <label htmlFor="rs-again" className="text-sm font-medium">Repeat new password</label>
            <input id="rs-again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            {mismatch && <p className="text-xs text-red-600">The two passwords don&apos;t match.</p>}
          </div>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <button type="submit" disabled={busy || mismatch || verdict !== 'ok' || pw !== again} className="w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
    </main>
  );
}
