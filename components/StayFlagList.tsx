'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';
import Link from 'next/link';

export interface StayFlagRow { id: string; kind: string; label: string; personId: string; personName: string; detail: string; createdAt: string; seen: boolean }

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// Stay alerts with "Mark as seen". Who may mark is decided by the server (Master or a parent).
export function StayFlagList({ flags, personHrefBase }: { flags: StayFlagRow[]; personHrefBase?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function seen(id: string) {
    setBusy(id);
    setError(null);
    try {
      await sendJson(`/api/stays/${encodeURIComponent(id)}/seen`, {});
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update.');
    } finally {
      setBusy(null);
    }
  }

  if (flags.length === 0) return <p className="text-sm text-gray-500">No stay alerts.</p>;
  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <ul className="space-y-2" data-testid="stay-flags">
        {flags.map((f) => (
          <li key={f.id} className={`rounded border p-3 text-sm ${f.seen ? 'border-gray-200 bg-white' : 'border-amber-200 bg-amber-50'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0">
                <b className="mr-1 rounded bg-amber-200 px-1.5 py-0.5 text-[11px] uppercase text-amber-950">{f.label}</b>
                {personHrefBase ? <Link href={personHrefBase + f.personId} className="font-semibold underline">{f.personName}</Link> : <span className="font-semibold">{f.personName}</span>} {f.detail}
                <span className="block text-xs text-gray-500">flagged {when(f.createdAt)}</span>
              </p>
              {f.seen ? <span className="text-xs text-gray-500">seen</span> : (
                <button type="button" onClick={() => seen(f.id)} disabled={busy === f.id}
                  className="inline-flex min-h-10 shrink-0 items-center rounded border border-gray-900 px-3 text-xs font-medium disabled:opacity-50 md:min-h-8">
                  {busy === f.id ? 'Saving…' : 'Mark as seen'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
