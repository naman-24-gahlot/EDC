'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ROLE_HOME_PATH, isSystemRole } from '@/lib/roles';
import { RequestError, sendJson } from '@/lib/clientFetch';

export function LoginForm({ notice }: { notice: string | null }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [networkError, setNetworkError] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await sendJson<{ systemRole?: string; mustChangePassword?: boolean }>('/api/auth/session', { identifier, password });
      const systemRole = data.systemRole;
      // Full page load: starts the new account with an empty page cache in this browser.
      // After a reset, the one-time password only opens the "choose a new password" page.
      window.location.assign(data.mustChangePassword ? '/set-password' : isSystemRole(systemRole) ? ROLE_HOME_PATH[systemRole] : '/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
      setNetworkError(err instanceof RequestError && err.noAnswer);
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 p-6"
      >
        <div>
          <h1 className="text-lg font-semibold">EDC Access Management</h1>
          <p className="text-sm text-gray-500">Sign in with your EDC account.</p>
        </div>

        <div className="space-y-1">
          <label htmlFor="identifier" className="text-sm font-medium">
            Username / EDC Email / Email
          </label>
          <input
            id="identifier"
            name="username"
            type="text"
            required
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        {notice && !error && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900" role="status">{notice}</p>}

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
            {/* Same hint for every sign-in failure, so it reveals nothing about which accounts exist. */}
            {!networkError && <span className="mt-1 block text-xs text-gray-600">Registered recently? You can sign in once an approver accepts your registration. Got a one-time password from an administrator? Use it here — you&apos;ll then choose your own.</span>}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="-mt-2 text-right text-sm"><Link href="/forgot" className="inline-flex min-h-10 items-center text-[#0D5B7A] underline md:min-h-0">Forgot password?</Link></p>

        <div className="space-y-2 border-t border-gray-100 pt-4 text-sm">
          <p>
            New to EDC?{' '}
            <Link href="/register" className="inline-flex min-h-10 items-center font-medium text-[#0D5B7A] underline md:min-h-0">Register here</Link>
          </p>
          <details className="text-xs text-gray-600">
            <summary className="inline-flex min-h-10 cursor-pointer items-center md:min-h-0">Already registered and stuck?</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li><b>Lost your pass or it stopped working?</b> Sign in, then use <i>Replace my QR code</i> on My account.</li>
              <li><b>Access ended?</b> Sign in and send a new access request from My account.</li>
              <li><b>Forgot your password?</b> Use <Link href="/forgot" className="underline">Forgot password</Link> to get an email link — or ask an EDC administrator for a one-time password.</li>
              <li><b>Don&apos;t register again</b> — your profile is kept even after access ends.</li>
            </ul>
          </details>
        </div>
      </form>
    </main>
  );
}
