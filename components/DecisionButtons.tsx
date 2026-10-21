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
        className="min-h-10 rounded bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50 md:min-h-0 md:px-2.5 md:py-1 md:text-xs">
        {busy === 'approve' ? 'Approving…' : 'Approve'}
      </button>
      <button onClick={() => decide('reject')} disabled={busy !== null} aria-label={`Reject ${what}`}
        className="min-h-10 rounded border border-gray-300 bg-white px-4 text-sm font-semibold disabled:opacity-50 md:min-h-0 md:px-2.5 md:py-1 md:text-xs">
        {busy === 'reject' ? 'Rejecting…' : 'Reject'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
