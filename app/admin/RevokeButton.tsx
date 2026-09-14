'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RevokeButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRevoke() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/requests/${requestId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not revoke');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke');
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        {error && <span className="text-xs text-red-600">{error}</span>}
        <button
          onClick={handleRevoke}
          disabled={loading}
          className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Revoking…' : 'Confirm revoke'}
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
      Revoke
    </button>
  );
}
