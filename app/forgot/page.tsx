'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { sendJson } from '@/lib/clientFetch';

// "Forgot password": always the same answer, whether or not the account exists.
export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await sendJson<{ message: string }>('/api/auth/forgot', { identifier });
      setDone(data.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 p-6">
        <div>
          <h1 className="text-lg font-semibold">Forgot your password?</h1>
          <p className="text-sm text-gray-500">We&apos;ll email a link to set a new one, to the email address you registered with.</p>
        </div>
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
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <button type="submit" disabled={busy} className="w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
              {busy ? 'Sending…' : 'Email me a reset link'}
            </button>
            <Link href="/login" className="block text-center text-xs text-gray-500 underline">Back to sign in</Link>
          </form>
        )}
      </div>
    </main>
  );
}
