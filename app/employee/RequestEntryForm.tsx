'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RequestEntryForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequest() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/employee/request', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not submit request');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit request');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded border border-gray-200 p-4">
      <p className="text-sm text-gray-600">You haven&apos;t requested entry for today yet.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        onClick={handleRequest}
        disabled={loading}
        className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {loading ? 'Requesting…' : 'Request entry for today'}
      </button>
    </div>
  );
}
