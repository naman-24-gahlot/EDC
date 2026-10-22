'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { InfoTip } from '@/components/InfoTip';

export function ReissueButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reissue() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/me/credential/reissue', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Could not reissue');
      setMessage('New QR issued. Any old QR or screenshot no longer works — open your pass to show the new one. Your access code is unchanged.');
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reissue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p>Use this if a screenshot of your QR was shared or your phone was lost. Every QR you&apos;ve shown or saved stops working right away; your pass shows a new one. Your access code and access period don&apos;t change.</p>
          <div className="flex gap-2">
            <button onClick={reissue} disabled={busy} className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">
              {busy ? 'Replacing…' : 'Yes, replace my QR'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <span className="inline-flex items-center">
          <button onClick={() => setConfirming(true)} className="inline-flex min-h-10 items-center md:min-h-0 text-sm font-medium text-amber-800 underline underline-offset-2">
            Replace my QR code
          </button>
          <InfoTip label="Replace my QR code">For a shared screenshot or a lost phone: every QR you&apos;ve shown or saved stops working, and your pass shows a new one. Your access code and access period stay the same.</InfoTip>
        </span>
      )}
      {message && <p className="text-sm text-gray-700" role="status">{message}</p>}
    </div>
  );
}
