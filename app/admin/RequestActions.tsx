'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RequestActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [note, setNote] = useState('');

  async function act(path: 'approve' | 'reject', body?: unknown) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/requests/${requestId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Action failed');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setLoading(false);
    }
  }

  if (showReject) {
    return (
      <div className="space-y-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (optional)"
          rows={2}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => act('reject', { reviewNote: note })}
            disabled={loading}
            className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? 'Rejecting…' : 'Confirm reject'}
          </button>
          <button
            onClick={() => setShowReject(false)}
            disabled={loading}
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => act('approve')}
          disabled={loading}
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Approving…' : 'Approve'}
        </button>
        <button
          onClick={() => setShowReject(true)}
          disabled={loading}
          className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
