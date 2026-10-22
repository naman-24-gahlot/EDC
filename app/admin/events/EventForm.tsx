'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';

export interface EventFields {
  name: string; details: string; venue: string; accessFrom: string; accessTo: string;
  gateOpens: string; gateCloses: string;
  /** "YYYY-MM-DDTHH:MM" in IST, as a datetime-local input holds it. */
  linkExpiresAt: string;
}

const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';
const label = 'text-xs font-semibold uppercase text-gray-500';
// datetime-local has no zone; the office works in IST, so that's what the input means.
const toIso = (local: string) => `${local}:00+05:30`;

// Create (no eventId) or edit an event. The server re-validates everything (lib/events.ts).
export function EventForm({ eventId, initial }: { eventId?: string; initial: EventFields }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof EventFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const body = { ...f, linkExpiresAt: toIso(f.linkExpiresAt) };
      if (eventId) {
        const changed = Object.fromEntries(Object.entries(body).filter(([k, v]) => v !== (k === 'linkExpiresAt' ? toIso(initial.linkExpiresAt) : initial[k as keyof EventFields])));
        await sendJson(`/api/events/${eventId}`, changed, 'PATCH');
        setMsg({ ok: true, text: 'Event saved. The link and everyone registered so far are unchanged.' });
        router.refresh();
      } else {
        const data = await sendJson<{ id: string }>('/api/events', body);
        router.push(`/admin/events/${data.id}`);
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not save the event.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" aria-label={eventId ? 'Edit event' : 'New event'}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2"><label htmlFor="ev-name" className={label}>Event name</label>
          <input id="ev-name" required maxLength={120} value={f.name} onChange={set('name')} className={field} placeholder="e.g. Startup Pitch Day 2026" /></div>
        <div className="space-y-1 sm:col-span-2"><label htmlFor="ev-details" className={label}>Details shown on the registration page</label>
          <textarea id="ev-details" rows={3} maxLength={2000} value={f.details} onChange={set('details')} className={field} placeholder="What it is, who should come, anything to bring" /></div>
        <div className="space-y-1 sm:col-span-2"><label htmlFor="ev-venue" className={label}>Venue (optional)</label>
          <input id="ev-venue" maxLength={200} value={f.venue} onChange={set('venue')} className={field} /></div>
        <div className="space-y-1"><label htmlFor="ev-from" className={label}>First day</label>
          <input id="ev-from" type="date" required value={f.accessFrom} onChange={set('accessFrom')} className={field} /></div>
        <div className="space-y-1"><label htmlFor="ev-to" className={label}>Last day</label>
          <input id="ev-to" type="date" required value={f.accessTo} onChange={set('accessTo')} className={field} /></div>
        <div className="space-y-1"><label htmlFor="ev-open" className={label}>Gate opens</label>
          <input id="ev-open" type="time" required value={f.gateOpens} onChange={set('gateOpens')} className={field} /></div>
        <div className="space-y-1"><label htmlFor="ev-close" className={label}>Gate closes</label>
          <input id="ev-close" type="time" required value={f.gateCloses} onChange={set('gateCloses')} className={field} /></div>
        <div className="space-y-1 sm:col-span-2"><label htmlFor="ev-expires" className={label}>Registration link works until (IST)</label>
          <input id="ev-expires" type="datetime-local" required value={f.linkExpiresAt} onChange={set('linkExpiresAt')} className={field} />
          <p className="text-xs text-gray-500">After this the link shows &quot;registration closed&quot; and refuses new sign-ups. Approved people keep their event access for the dates above.</p></div>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
      <button type="submit" disabled={busy || (!!eventId && !dirty)} className="inline-flex min-h-10 items-center rounded bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50 md:min-h-9">
        {busy ? 'Saving…' : eventId ? 'Save changes' : 'Create event and link'}
      </button>
    </form>
  );
}
