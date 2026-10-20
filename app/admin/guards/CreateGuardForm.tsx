'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const EMPTY = { firstName: '', lastName: '', username: '', commEmail: '', mobile: '' };

export function CreateGuardForm() {
  const router = useRouter();
  const [fields, setFields] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/guards', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Could not create guard');
      setCreated({ username: data.username, password: data.password });
      setFields(EMPTY);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create guard');
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';
  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-gray-200 p-4" aria-label="Create guard">
      <h2 className="text-sm font-semibold">Create a guard</h2>
      {created && (
        <div role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
          Guard created. Sign-in: <span className="font-mono">{created.username}</span> / <span className="font-mono">{created.password}</span>
          <span className="block text-xs text-gray-600">Shown once — hand it over now.</span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <input aria-label="First name" placeholder="First name" value={fields.firstName} onChange={set('firstName')} required className={input} />
        <input aria-label="Last name" placeholder="Last name" value={fields.lastName} onChange={set('lastName')} required className={input} />
        <input aria-label="Username" placeholder="Username" value={fields.username} onChange={set('username')} required className={input} />
        <input aria-label="Email" type="email" placeholder="Email" value={fields.commEmail} onChange={set('commEmail')} required className={input} />
        <input aria-label="Mobile" placeholder="Mobile" value={fields.mobile} onChange={set('mobile')} required className={input} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy} className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create guard'}</button>
    </form>
  );
}
