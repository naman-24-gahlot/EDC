'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';
import { InfoTip } from '@/components/InfoTip';

const SOURCES = ['whatsapp', 'email', 'poster', 'instagram', 'linkedin'];
const TAG = /^[A-Za-z0-9._-]{0,40}$/;

// The event's registration link: copy it plain or tagged with where it's being shared (utm_*),
// so the event page can count sign-ups per channel. Close / reopen / replace control the link.
export function LinkPanel({ eventId, token, state, expires, origin }: { eventId: string; token: string; state: 'OPEN' | 'CLOSED' | 'EXPIRED'; expires: string; origin: string }) {
  const router = useRouter();
  const [source, setSource] = useState('');
  const [medium, setMedium] = useState('');
  const [campaign, setCampaign] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const q = new URLSearchParams();
  if (source) q.set('utm_source', source);
  if (medium) q.set('utm_medium', medium);
  if (campaign) q.set('utm_campaign', campaign);
  const url = `${origin}/e/${token}${q.size ? `?${q}` : ''}`;
  const tagsOk = [source, medium, campaign].every((t) => TAG.test(t));

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg({ ok: false, text: 'Copying is blocked here — select the link and copy it by hand.' });
    }
  }

  async function command(cmd: 'close' | 'reopen' | 'new-link', confirmText: string, done: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      await sendJson(`/api/events/${eventId}`, { command: cmd }, 'PATCH');
      setMsg({ ok: true, text: done });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not update the link.' });
    } finally {
      setBusy(false);
    }
  }

  const btn = 'inline-flex min-h-10 items-center rounded border px-3 text-sm font-medium disabled:opacity-50 md:min-h-8';
  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {state === 'OPEN' && <>Open — people can register until <b>{expires}</b>.</>}
        {state === 'EXPIRED' && <>Expired on <b>{expires}</b> — the link now says registration is over. Move the date later and reopen to accept more.</>}
        {state === 'CLOSED' && <>Closed by a Master — the link says registration is closed. Reopen it to accept more.</>}
      </p>

      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input readOnly value={url} aria-label="Registration link" onFocus={(e) => e.target.select()} className="min-w-0 flex-1 basis-64 rounded border border-gray-300 bg-gray-50 px-2 py-1.5 font-mono text-xs" />
          <button type="button" onClick={copy} disabled={!tagsOk} className={`${btn} border-gray-900 bg-gray-900 text-white`}>{copied ? 'Copied ✓' : 'Copy link'}</button>
        </div>
        <details>
          <summary className="inline-flex min-h-10 cursor-pointer items-center text-xs font-semibold text-gray-600 md:min-h-0">Tag where you&apos;re sharing it (UTM) — see sign-ups per channel</summary>
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map((s) => (
                <button key={s} type="button" onClick={() => setSource(source === s ? '' : s)} aria-pressed={source === s}
                  className={`min-h-9 rounded-full px-3 text-xs md:min-h-7 ${source === s ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>{s}</button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-gray-500">Source<input value={source} onChange={(e) => setSource(e.target.value)} placeholder="whatsapp" className={input} /></label>
              <label className="space-y-1 text-xs text-gray-500">Medium<input value={medium} onChange={(e) => setMedium(e.target.value)} placeholder="group / dm / print" className={input} /></label>
              <label className="space-y-1 text-xs text-gray-500">Campaign<input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="batch-2026" className={input} /></label>
            </div>
            {!tagsOk && <p className="text-xs text-red-700">Tags can use letters, numbers, dot, dash and underscore (up to 40).</p>}
          </div>
        </details>
      </div>

      <div className="flex flex-wrap gap-2">
        {state === 'OPEN' ? (
          <button className={`${btn} border-red-300 text-red-700`} disabled={busy}
            onClick={() => command('close', 'Close registration now?\n\nThe link will say registration is closed. People already registered are not affected. You can reopen it.', 'Registration closed. The link now says so.')}>
            Close registration now
          </button>
        ) : (
          <button className={`${btn} border-emerald-400 text-emerald-800`} disabled={busy}
            onClick={() => command('reopen', 'Reopen registration on the same link?', 'Registration reopened on the same link.')}>
            Reopen registration
          </button>
        )}
        <button className={`${btn} border-gray-400`} disabled={busy}
          onClick={() => command('new-link', 'Replace the link?\n\nThe current link (and every copy shared so far) stops working at once. You will need to share the new one.', 'New link made — the old one no longer works. Copy and share the new link.')}>
          Replace link
        </button>
        <InfoTip label="link controls" align="left">
          <b>Close</b>: the link says registration is closed; people already registered are unaffected. <b>Reopen</b>: the same link works again (until its end time). <b>Replace link</b>: makes a new link — every copy of the old one stops working at once.
        </InfoTip>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</p>}
    </div>
  );
}
