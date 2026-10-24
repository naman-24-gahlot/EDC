'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';
import { InfoTip } from '@/components/InfoTip';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const blank = () => ({ firstName: '', lastName: '', mobile: '', email: '', purpose: '', vvip: false, startDate: today(), days: 1, startTime: '09:00', endTime: '18:00' });
type Created = { accessCode: string; passUrl: string; access: string; emailed: boolean; name: string };

// "Visitor pass": a one- or two-day guest without them registering. The server decides who may
// (an active employee or a Master); the pass link it returns is the visitor's pass.
export function VisitorForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await sendJson<Omit<Created, 'name'>>('/api/visitors', { ...v, email: v.email.trim() || undefined });
      setCreated({ ...r, name: `${v.firstName} ${v.lastName}` });
      setV(blank());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the pass.');
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-normal normal-case text-gray-900';
  const label = 'space-y-1 text-xs font-semibold uppercase text-gray-500';
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  if (!open) {
    return (
      <button type="button" onClick={() => { setOpen(true); setCreated(null); }} className="inline-flex min-h-10 items-center rounded border border-gray-900 px-3 text-sm font-medium md:min-h-8">
        + Visitor pass (1–2 days)
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4" data-testid="visitor-form">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-sm font-semibold">
          New visitor pass
          <InfoTip label="About visitor passes">For a guest coming for a day or two — no registration, no account. They get an access code and a pass link (emailed if you give their email; you can also copy it and send it yourself). Mark VVIP and the guard sees it, and you get an email when they arrive. For longer visits, have them register instead.</InfoTip>
        </h3>
        <button type="button" onClick={() => setOpen(false)} className="min-h-10 text-xs text-gray-500 underline md:min-h-0">Close</button>
      </div>
      {created && (
        <div className="space-y-1 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm" role="status" data-testid="visitor-created">
          <p><b>{created.name}</b> — <span className="font-mono font-semibold">{created.accessCode}</span> · {created.access}</p>
          <p className="break-all text-xs"><a href={created.passUrl} target="_blank" rel="noreferrer" className="underline">{created.passUrl}</a></p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => navigator.clipboard.writeText(created.passUrl).then(() => setCopied(true), () => {})} className="inline-flex min-h-10 items-center rounded border border-gray-300 bg-white px-3 text-xs font-medium md:min-h-8">{copied ? 'Copied ✓' : 'Copy pass link'}</button>
            <span className="text-xs text-gray-600">{created.emailed ? 'Also emailed to them.' : 'No email given — send them the link yourself.'}</span>
          </div>
        </div>
      )}
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2" aria-label="New visitor pass">
        <label className={label}><span className="block">First name</span><input value={v.firstName} onChange={set('firstName')} required className={input} /></label>
        <label className={label}><span className="block">Last name</span><input value={v.lastName} onChange={set('lastName')} required className={input} /></label>
        <label className={label}><span className="block">Mobile</span><input type="tel" value={v.mobile} onChange={set('mobile')} required className={input} /></label>
        <label className={label}><span className="block">Email (optional — the pass is sent here)</span><input type="email" value={v.email} onChange={set('email')} className={input} /></label>
        <label className={`${label} sm:col-span-2`}><span className="block">Purpose of visit</span><input value={v.purpose} onChange={set('purpose')} required className={input} /></label>
        <label className={label}><span className="block">Date</span><input type="date" value={v.startDate} min={today()} onChange={set('startDate')} required className={input} /></label>
        <label className={label}><span className="block">Days</span>
          <select value={v.days} onChange={(e) => setV({ ...v, days: Number(e.target.value) })} className={input}><option value={1}>1 day</option><option value={2}>2 days</option></select></label>
        <label className={label}><span className="block">From</span><input type="time" value={v.startTime} onChange={set('startTime')} required className={input} /></label>
        <label className={label}><span className="block">Until</span><input type="time" value={v.endTime} onChange={set('endTime')} required className={input} /></label>
        <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={v.vvip} onChange={(e) => setV({ ...v, vvip: e.target.checked })} /> VVIP — the guard sees it and you’re emailed when they arrive
        </label>
        {error && <p className="text-sm text-red-700 sm:col-span-2" role="alert">{error}</p>}
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50 md:min-h-8">{busy ? 'Creating…' : 'Create pass'}</button>
        </div>
      </form>
    </div>
  );
}
