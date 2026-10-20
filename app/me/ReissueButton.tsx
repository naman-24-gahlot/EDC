'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
      setMessage('Done — your old QR no longer works. Open your pass to get the new one.');
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
          <p>Every QR you&apos;ve shown or screenshotted stops working immediately. Your access code stays the same.</p>
          <div className="flex gap-2">
            <button onClick={reissue} disabled={busy} className="rounded bg-amber-700 px-3 py-1.5 font-medium text-white disabled:opacity-50">
              {busy ? 'Reissuing…' : 'Yes, reissue my pass'}
            </button>
            <button onClick={() => setConfirming(false)} disabled={busy} className="rounded border border-gray-300 px-3 py-1.5">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-sm font-medium text-amber-800 underline underline-offset-2">
          Reissue my pass
        </button>
      )}
      {message && <p className="text-sm text-gray-700" role="status">{message}</p>}
    </div>
  );
}
