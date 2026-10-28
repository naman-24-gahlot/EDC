'use client';

import { useState, type FormEvent } from 'react';
import { RequestError, sendJson } from '@/lib/clientFetch';

// On a no-password event guest's pass link: remove everything EDC holds about them
// (POST /api/pass/delete, authorised by the link itself).
export function DeleteMyData({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendJson('/api/pass/delete', { token, confirm });
      setDone(true);
    } catch (err) {
      setError(err instanceof RequestError || err instanceof Error ? err.message : 'Could not delete your data.');
    } finally {
      setBusy(false);
    }
  }

  if (done) return <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status" data-testid="data-deleted">Your details, photo, pass and gate records have been deleted. This link no longer works.</p>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-4 block w-full text-center text-xs text-red-700 underline">Delete my data…</button>;
  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded border border-red-200 bg-red-50 p-4 text-sm" aria-label="Delete my data">
      <p className="text-red-900">This removes your name, photo, contact details, pass and gate records from EDC for good, and this pass stops working. It can’t be undone. The audit log keeps that a record was deleted, with your details removed.</p>
      <label className="block space-y-1">
        <span className="font-medium">Type <b>DELETE</b> to confirm</span>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="characters" autoComplete="off" required className="w-full rounded border border-gray-300 px-3 py-2" />
      </label>
      {error && <p className="text-red-700" role="alert">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || confirm !== 'DELETE'} className="inline-flex min-h-10 items-center rounded bg-red-700 px-3 font-medium text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete my data'}</button>
        <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3">Cancel</button>
      </div>
    </form>
  );
}
