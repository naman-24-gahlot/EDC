'use client';

import { useState } from 'react';
import { sendJson } from '@/lib/clientFetch';

// Shown on My account until the person's email is confirmed (the link proves the inbox is theirs,
// and "Forgot password" needs it).
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setState('busy');
    setError(null);
    try {
      await sendJson('/api/me/verify-email');
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email.');
      setState('idle');
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950" data-testid="verify-email">
      <p><b>Confirm your email.</b> We sent a link to <span className="break-all">{email}</span>. Opening it confirms the address is yours — it&apos;s where password-reset links go.</p>
      {state === 'sent' ? <p role="status">Sent. Check your inbox (and spam) in a minute or two.</p> : (
        <button onClick={send} disabled={state === 'busy'} className="inline-flex min-h-10 items-center rounded border border-sky-400 bg-white px-3 font-medium disabled:opacity-50 md:min-h-8">
          {state === 'busy' ? 'Sending…' : 'Send the link again'}
        </button>
      )}
      {error && <p className="text-red-700" role="alert">{error}</p>}
    </div>
  );
}
