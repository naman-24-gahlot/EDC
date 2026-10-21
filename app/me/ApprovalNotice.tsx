'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// One-time notice: shown until the person dismisses it, then never again (seenAt is stored).
export function ApprovalNotice({ appliedAs, approvedAs, code, access }: { appliedAs: string; approvedAs: string; code: string | null; access: string | null }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  if (hidden) return null;

  async function dismiss() {
    setBusy(true);
    const res = await fetch('/api/me/notice', { method: 'POST' }).catch(() => null);
    if (res?.ok) { setHidden(true); router.refresh(); } else setBusy(false);
  }

  return (
    <div role="alertdialog" aria-labelledby="notice-title" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-testid="approval-notice">
      <p id="notice-title" className="font-semibold">Your registration was approved as {approvedAs}</p>
      <p>
        You applied as <b>{appliedAs}</b>; your approver registered you as <b>{approvedAs}</b> instead.
        {code && <> Your access code is <span className="font-mono font-semibold">{code}</span>.</>}
        {access && <> Your access: {access}.</>}
      </p>
      <button onClick={dismiss} disabled={busy} className="inline-flex min-h-10 items-center rounded bg-amber-800 px-4 font-semibold text-white disabled:opacity-50">
        {busy ? 'Saving…' : 'OK, got it'}
      </button>
    </div>
  );
}
