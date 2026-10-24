'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';

const TYPES = [['employee', 'Employees'], ['incubee', 'Incubees'], ['driver', 'Drivers'], ['relative', 'Relatives'], ['bodyguard', 'Bodyguards'], ['event_guest', 'Event guests'], ['visitor', 'Visitors']] as const;
const DEFAULT = new Set(['employee', 'incubee', 'driver', 'relative', 'bodyguard']);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function HolidayForm() {
  const router = useRouter();
  const [form, setForm] = useState({ date: today(), name: '' });
  const [types, setTypes] = useState<Set<string>>(new Set(DEFAULT));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await sendJson('/api/holidays', { ...form, appliesTo: [...types] });
      setMsg({ ok: true, text: `Added — the gate treats ${form.date} as a holiday.` });
      setForm({ date: today(), name: '' });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not add.' });
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4" aria-label="Add a holiday">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-sm"><span className="block font-medium">Date</span><input type="date" min={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required className={input} /></label>
        <label className="space-y-1 text-sm sm:col-span-2"><span className="block font-medium">Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} placeholder="e.g. Diwali" className={input} /></label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Campus closed for</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TYPES.map(([t, l]) => (
            <label key={t} className="flex min-h-10 items-center gap-1.5 text-sm md:min-h-0">
              <input type="checkbox" checked={types.has(t)} onChange={(e) => { const n = new Set(types); if (e.target.checked) n.add(t); else n.delete(t); setTypes(n); }} /> {l}
            </label>
          ))}
        </div>
        <p className="text-xs text-gray-500">Event guests and visitors are left out by default — their passes are for dates someone picked on purpose.</p>
      </fieldset>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      <button type="submit" disabled={busy || types.size === 0} className="inline-flex min-h-10 items-center rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50 md:min-h-8">{busy ? 'Adding…' : 'Add holiday'}</button>
    </form>
  );
}

export function RemoveHoliday({ date, name }: { date: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (!window.confirm(`Remove the holiday “${name}” on ${date}? The gate goes back to everyone’s usual days.`)) return;
    setBusy(true);
    try {
      await sendJson(`/api/holidays/${date}`, undefined, 'DELETE');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove.');
      setBusy(false);
    }
  }
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-700">{error}</span>}
      <button type="button" onClick={remove} disabled={busy} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-2 text-xs md:min-h-7">{busy ? '…' : 'Remove'}</button>
    </span>
  );
}
