'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface CreatedAccount {
  email: string;
  displayName: string;
  password: string;
}

export function AddEmployeeForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedAccount | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Could not add employee');
      setCreated({ email: data.email, displayName: data.displayName, password: data.password });
      setEmail('');
      setDisplayName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add employee');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded border border-gray-200 p-4">
      <h3 className="text-sm font-medium">Add temporary employee</h3>

      {created && (
        <div className="space-y-1 rounded border border-green-300 bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-800">
            Account created for {created.displayName}.
          </p>
          <p className="text-green-800">
            Email: <span className="font-mono">{created.email}</span>
          </p>
          <p className="text-green-800">
            Temporary password: <span className="font-mono">{created.password}</span>
          </p>
          <p className="text-xs text-green-700">
            Share this password with them directly — it won&apos;t be shown again.
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="new-emp-name" className="text-xs font-medium text-gray-600">
            Display name
          </label>
          <input
            id="new-emp-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="new-emp-email" className="text-xs font-medium text-gray-600">
            Email
          </label>
          <input
            id="new-emp-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Adding…' : 'Add employee'}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
