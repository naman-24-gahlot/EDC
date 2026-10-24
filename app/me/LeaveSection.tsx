'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';

export interface MyLeave { id: string; range: string; reason: string; status: string; note: string | null; cancellable: boolean }

const STYLE: Record<string, string> = { PENDING: 'bg-amber-100 text-amber-900', APPROVED: 'bg-emerald-100 text-emerald-900', REJECTED: 'bg-red-100 text-red-900', CANCELLED: 'bg-gray-100 text-gray-600' };
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

// An employee's own leave: ask for it, see the decisions, cancel until it has ended.
export function LeaveSection({ leave }: { leave: MyLeave[] }) {
  const router = useRouter();
  const [form, setForm] = useState({ startDate: today(), endDate: today(), reason: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(key: string, url: string, body: unknown, done: string) {
    setBusy(key);
    setMsg(null);
    try {
      await sendJson(url, body);
      setMsg({ ok: true, text: done });
      router.refresh();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong.' });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run('new', '/api/leave', form, 'Leave requested — you’ll get an email when it’s decided.')) setForm({ startDate: today(), endDate: today(), reason: '' });
  }

  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-3" aria-label="Ask for leave">
        <label className="space-y-1 text-sm"><span className="block font-medium">First day</span>
          <input type="date" value={form.startDate} min={today()} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} required className={input} /></label>
        <label className="space-y-1 text-sm"><span className="block font-medium">Last day</span>
          <input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required className={input} /></label>
        <label className="space-y-1 text-sm sm:col-span-3"><span className="block font-medium">Reason</span>
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required maxLength={200} className={input} /></label>
        <div className="sm:col-span-3">
          <button type="submit" disabled={busy !== null} className="inline-flex min-h-10 items-center rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50 md:min-h-8">{busy === 'new' ? 'Sending…' : 'Ask for leave'}</button>
        </div>
      </form>
      {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</p>}
      {leave.length === 0 ? <p className="text-sm text-[#7C8C9B]">No leave asked for yet.</p> : (
        <ul className="divide-y divide-[#D5DDE4]" data-testid="my-leave">
          {leave.map((l) => (
            <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
              <span className="min-w-0"><b>{l.range}</b> — {l.reason}{l.note && <span className="block text-xs text-[#7C8C9B]">“{l.note}”</span>}</span>
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STYLE[l.status] ?? ''}`}>{l.status}</span>
                {l.cancellable && (
                  <button type="button" disabled={busy !== null} onClick={() => run(l.id, `/api/leave/${l.id}/cancel`, {}, 'Leave cancelled.')}
                    className="inline-flex min-h-10 items-center rounded border border-gray-300 px-2 text-xs md:min-h-7">{busy === l.id ? '…' : 'Cancel'}</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
