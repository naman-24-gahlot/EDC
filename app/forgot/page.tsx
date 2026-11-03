'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { sendJson } from '@/lib/clientFetch';
import { HumanCheck, humanCheckOn, useHumanCheck } from '@/components/HumanCheck';
import { AuthBrand, authCard, primaryButton } from '@/components/AuthBackdrop';
import { AuthScene } from '@/components/brand/AuthScene';

// "Forgot password": always the same answer, whether or not the account exists.
export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { token: humanToken, setToken: setHumanToken, round: humanRound, used: humanUsed } = useHumanCheck();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await sendJson<{ message: string }>('/api/auth/forgot', { identifier, humanToken });
      setDone(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email.');
    } finally {
      setBusy(false);
      humanUsed(); // a token works once
    }
  }

  return (
    <main className="relative flex flex-1 items-center justify-center px-4 py-8">
      <AuthScene />
      <div className={`${authCard} beam stagger space-y-4`}>
        <AuthBrand title="Forgot your password?" subtitle="We’ll email a link to set a new one, to the email address you registered with." />
        {done ? (
          <div className="space-y-3" role="status">
            <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{done}</p>
            <p className="text-xs text-gray-500">Nothing after a few minutes? Check spam, or ask an EDC administrator to reset it for you.</p>
            <Link href="/login" className="inline-flex min-h-10 items-center text-sm font-medium underline">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="fp-id" className="text-sm font-medium">Username / EDC Email / Email</label>
              <input id="fp-id" name="username" autoComplete="username" required maxLength={254} value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <HumanCheck key={humanRound} onToken={setHumanToken} />
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <button type="submit" disabled={busy || (humanCheckOn && !humanToken)} className={primaryButton}>
              {busy ? 'Sending…' : 'Email me a reset link'}
            </button>
            <Link href="/login" className="flex min-h-10 items-center justify-center text-xs text-gray-500 underline">Back to sign in</Link>
          </form>
        )}
      </div>
    </main>
  );
}
