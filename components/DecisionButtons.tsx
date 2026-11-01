'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Inline approve/reject for a registration or an access request. Authority is decided by
// the API (assertCanActOn); this only sends the click. After it's done, a ✓ confirms the
// decision for a moment before the list refreshes (state indication — styles in app/globals.css).
export function DecisionButtons({ base, what }: { base: string; what: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'approve' | 'reject' | null>(null);

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`${base}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Could not ${action}`);
      setDone(action);
      setTimeout(() => router.refresh(), 450);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action}`);
    } finally {
      setBusy(null);
    }
  }

  if (done) return <DoneChip action={done} />;
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

export function DoneChip({ action }: { action: 'approve' | 'reject' }) {
  const ok = action === 'approve';
  return (
    <span role="status" className={`pop-in inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold md:min-h-0 md:py-1 md:text-xs ${ok ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200' : 'bg-gray-100 text-gray-700 ring-1 ring-gray-200'}`}>
      <svg viewBox="0 0 24 24" className="draw-check h-4 w-4" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ok ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
      </svg>
      {ok ? 'Approved' : 'Rejected'}
    </span>
  );
}
