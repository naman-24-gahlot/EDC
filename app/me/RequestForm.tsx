'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export function RequestForm({ disabledReason }: { disabledReason: string | null }) {
  const router = useRouter();
  const [purpose, setPurpose] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purpose,
          ...(startDate ? { requestedStartDate: startDate } : {}),
          ...(endDate ? { requestedEndDate: endDate } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Could not send request');
      setPurpose('');
      setStartDate('');
      setEndDate('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send request');
    } finally {
      setBusy(false);
    }
  }

  if (disabledReason) return <p className="text-sm text-gray-500">{disabledReason}</p>;

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="purpose" className="text-sm font-medium">Purpose</label>
        <input id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} required maxLength={500}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm" placeholder="Why do you need access?" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="start" className="text-sm font-medium">From (optional)</label>
          <input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div className="space-y-1">
          <label htmlFor="end" className="text-sm font-medium">Until (optional)</label>
          <input id="end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>
      <p className="text-xs text-gray-500">Leave dates empty to get your profile&apos;s usual period. Requests not decided within 3 days expire.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy || !purpose.trim()} className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
        {busy ? 'Sending…' : 'Request access'}
      </button>
    </form>
  );
}
