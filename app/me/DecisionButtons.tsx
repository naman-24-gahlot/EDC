'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Inline approve/reject for a registration or an access request. Authority is decided by
// the API (assertCanActOn); this only sends the click.
export function DecisionButtons({ base, what }: { base: string; what: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Could not ${action}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => decide('approve')} disabled={busy !== null} aria-label={`Approve ${what}`}
        className="rounded bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
        {busy === 'approve' ? 'Approving…' : 'Approve'}
      </button>
      <button onClick={() => decide('reject')} disabled={busy !== null} aria-label={`Reject ${what}`}
        className="rounded border border-gray-300 px-2.5 py-1 text-xs font-semibold disabled:opacity-50">
        {busy === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
