'use client';

import { useEffect, useState } from 'react';
import { RequestError, sendJson } from '@/lib/clientFetch';

type Verdict = { ok: boolean; message: string | null };
const POLL_MS = 4000;
const POLL_FOR_MS = 30 * 60 * 1000;

// The email box with "Send confirmation link" beside it. Registration can't be submitted until
// the link has been opened (here, in another tab, or on a phone) — this asks the server every
// few seconds and flips to "✓ confirmed" on its own. Changing the email starts over.
export function EmailConfirm({ value, onChange, hint, humanToken, onConfirmed }: {
  value: string; onChange: (v: string) => void; hint: Verdict | null; humanToken: string; onConfirmed: (ok: boolean) => void;
}) {
  const [sentTo, setSentTo] = useState<{ email: string; at: number } | null>(null);
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const email = value.trim();
  const confirmed = !!email && confirmedFor?.toLowerCase() === email.toLowerCase();
  const waiting = !!sentTo && sentTo.email === email && !confirmed;

  useEffect(() => { onConfirmed(confirmed); }, [confirmed, onConfirmed]);

  // Already confirmed earlier (form closed and reopened, or a second tab)? Ask once typing pauses,
  // so the person doesn't need to send another link.
  useEffect(() => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || confirmed) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/register/email-check?email=${encodeURIComponent(email)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (live && r?.confirmed) setConfirmedFor(email);
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [email, confirmed]);

  useEffect(() => {
    if (!waiting || !sentTo) return;
    const timer = setInterval(async () => {
      if (Date.now() - sentTo.at > POLL_FOR_MS) return clearInterval(timer);
      const r = await fetch(`/api/register/email-check?email=${encodeURIComponent(sentTo.email)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (r?.confirmed) setConfirmedFor(sentTo.email);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, sentTo]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/register/email-check', { email, humanToken });
      setSentTo({ email, at: Date.now() });
    } catch (err) {
      setError(err instanceof RequestError || err instanceof Error ? err.message : 'Could not send the email.');
    } finally {
      setBusy(false);
    }
  }

  const canSend = !!email && (hint === null || hint.ok) && !busy && !confirmed;
  return (
    <div className="space-y-1">
      <label htmlFor="reg-email" className="text-sm font-medium">Communication email</label>
      <div className="flex flex-wrap gap-2">
        <input id="reg-email" type="email" required autoComplete="email" value={value} onChange={(e) => { onChange(e.target.value); setError(null); }}
          aria-invalid={hint ? !hint.ok : undefined} aria-describedby="reg-email-status"
          className={`min-w-0 flex-1 basis-48 rounded border px-3 py-2 text-sm ${hint && !hint.ok ? 'border-red-400' : confirmed ? 'border-emerald-500' : 'border-gray-300'}`} />
        {confirmed ? (
          <span className="inline-flex min-h-10 items-center rounded bg-emerald-50 px-3 text-sm font-semibold text-emerald-800">✓ Confirmed</span>
        ) : (
          <button type="button" onClick={send} disabled={!canSend}
            className="inline-flex min-h-10 shrink-0 items-center rounded border border-gray-900 px-3 text-sm font-medium disabled:opacity-40">
            {busy ? 'Sending…' : waiting ? 'Send again' : 'Send confirmation link'}
          </button>
        )}
      </div>
      <div id="reg-email-status" aria-live="polite" className="text-xs">
        {hint && !hint.ok ? <p className="text-red-700">{hint.message}</p>
          : confirmed ? <p className="text-emerald-700">Confirmed — you can finish and submit the form.</p>
          : waiting ? <p className="text-gray-600">Sent to <b className="break-all">{sentTo!.email}</b>. Open the link in the email (any device); this updates by itself. Not there? Check spam, or press Send again.</p>
          : <p className="text-gray-500">You’ll need to confirm this address before you can submit — we email you a link.</p>}
        {error && <p className="text-red-700" role="alert">{error}</p>}
      </div>
    </div>
  );
}
