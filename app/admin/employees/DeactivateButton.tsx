'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function DeactivateButton({ uid }: { uid: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDeactivate() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/employees/${uid}/deactivate`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not deactivate');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not deactivate');
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          onClick={handleDeactivate}
          disabled={loading}
          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Deactivating…' : 'Confirm'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="rounded border border-gray-300 px-2 py-1 text-xs"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-red-700"
    >
      Deactivate
    </button>
  );
}
