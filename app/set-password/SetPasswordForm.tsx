'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ROLE_HOME_PATH, isSystemRole } from '@/lib/roles';
import { RequestError, sendJson } from '@/lib/clientFetch';
import { PasswordField } from '@/components/PasswordField';

export function SetPasswordForm({ username, name }: { username: string; name: string }) {
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; signIn: boolean } | null>(null);
  const mismatch = confirm.length > 0 && next !== confirm;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const data = await sendJson<{ systemRole?: string }>('/api/auth/set-password', { newPassword: next });
      // Full load: the new session starts with a clean page cache.
      window.location.assign(isSystemRole(data.systemRole) ? ROLE_HOME_PATH[data.systemRole] : '/');
    } catch (err) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load, as above
      if (err instanceof RequestError && err.data?.done) return window.location.assign('/');
      const text = err instanceof RequestError && err.noAnswer
        ? `${err.message} If it keeps failing, your new password may already be saved — try signing in with it.`
        : err instanceof Error ? err.message : 'Could not set your password.';
      setError({ text, signIn: err instanceof RequestError && (err.sessionEnded || err.status === 409) });
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => null);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load after sign-out
    window.location.assign('/login');
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 p-6" aria-label="Choose a new password">
        {/* Names the account for the browser's password manager, so it saves the right login. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <div>
          <h1 className="text-lg font-semibold">Choose your new password</h1>
          <p className="text-sm text-gray-500">
            {name ? `${name}, you` : 'You'} signed in with a one-time password. Choose your own before continuing — it can&apos;t be the one-time password or your previous password.
          </p>
        </div>
        <PasswordField id="sp-new" label="New password" value={next} onChange={setNext} ctx={{ username }} />
        <div className="space-y-1">
          <label htmlFor="sp-confirm" className="text-sm font-medium">Repeat new password</label>
          <input id="sp-confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          {mismatch && <p className="text-xs text-red-600">The two passwords don&apos;t match.</p>}
        </div>
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error.text}{error.signIn && <> <Link href="/login" className="font-medium underline">Go to sign in</Link></>}
          </p>
        )}
        <button type="submit" disabled={busy || mismatch || next.length < 8} className="w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" onClick={signOut} className="w-full text-xs text-gray-500 underline">Sign out instead</button>
      </form>
    </main>
  );
}
