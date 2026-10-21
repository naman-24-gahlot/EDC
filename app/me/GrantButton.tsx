'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Direct grant with the person's profile-type default period. Authority is the API's
// (Master or an ancestor, via assertCanActOn); this only sends the click.
export function GrantButton({ personId, name, summary }: { personId: string; name: string; summary: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant() {
    if (!window.confirm(`Give ${name} their usual access?\n\n${summary}`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/people/${personId}/entitlements`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Could not grant access');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant access');
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button onClick={grant} disabled={busy} aria-label={`Give ${name} default access: ${summary}`} title={summary}
        className="min-h-9 rounded border border-emerald-700 px-3 text-xs font-semibold text-emerald-800 disabled:opacity-50 md:min-h-0 md:px-2 md:py-0.5 md:text-[11px]">
        {busy ? 'Granting…' : 'Give usual access'}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
