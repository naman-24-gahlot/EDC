'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { downscalePhoto } from '@/lib/photo';

type Panel = 'details' | 'password' | null;

const input = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';
const btn = 'rounded px-3 py-2 text-sm font-medium disabled:opacity-50';

export function AccountSettings({ initial }: { initial: { firstName: string; lastName: string; mobile: string; purpose: string } }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [details, setDetails] = useState(initial);
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);

  async function send(method: string, url: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Something went wrong');
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Something went wrong' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDetails(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = {};
    (Object.keys(details) as (keyof typeof details)[]).forEach((k) => { if (details[k] !== initial[k]) patch[k] = details[k]; });
    if (photo !== undefined) patch.photoDataUrl = photo;
    if (Object.keys(patch).length === 0) return setMessage({ ok: false, text: 'Nothing changed.' });
    if (await send('PATCH', '/api/me/profile', patch)) {
      setMessage({ ok: true, text: 'Details saved.' });
      setPanel(null);
      router.refresh();
    }
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setPhoto(await downscalePhoto(file)); } catch { setMessage({ ok: false, text: 'Could not process that photo — try a different image.' }); }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) return setMessage({ ok: false, text: 'The two new passwords don’t match.' });
    if (await send('POST', '/api/me/password', { currentPassword: pw.current, newPassword: pw.next })) {
      setPw({ current: '', next: '', confirm: '' });
      setPanel(null);
      setMessage({ ok: true, text: 'Password changed. Other devices have been signed out; this one stays signed in.' });
    }
  }

  async function signOutEverywhere() {
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- deliberate full load: clears the in-browser page cache between accounts
    if (await send('DELETE', '/api/me/sessions')) window.location.assign('/login');
  }

  return (
    <div className="space-y-3">
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPanel(panel === 'details' ? null : 'details')} aria-expanded={panel === 'details'} className={`${btn} border border-gray-300 bg-white`}>Edit my details</button>
        <button type="button" onClick={() => setPanel(panel === 'password' ? null : 'password')} aria-expanded={panel === 'password'} className={`${btn} border border-gray-300 bg-white`}>Change password</button>
        {!confirmEverywhere ? (
          <button type="button" onClick={() => setConfirmEverywhere(true)} className={`${btn} border border-red-200 bg-white text-red-700`}>Sign out of all devices</button>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            Every device, including this one?
            <button type="button" onClick={signOutEverywhere} disabled={busy} className={`${btn} bg-red-700 text-white`}>Yes, sign out everywhere</button>
            <button type="button" onClick={() => setConfirmEverywhere(false)} className={`${btn} border border-gray-300`}>Cancel</button>
          </span>
        )}
      </div>

      {panel === 'details' && (
        <form onSubmit={saveDetails} className="space-y-3 rounded border border-gray-200 bg-white p-4" aria-label="Edit my details">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label htmlFor="as-first" className="text-sm font-medium">First name</label><input id="as-first" value={details.firstName} onChange={(e) => setDetails({ ...details, firstName: e.target.value })} required className={input} /></div>
            <div className="space-y-1"><label htmlFor="as-last" className="text-sm font-medium">Last name</label><input id="as-last" value={details.lastName} onChange={(e) => setDetails({ ...details, lastName: e.target.value })} required className={input} /></div>
          </div>
          <div className="space-y-1"><label htmlFor="as-mobile" className="text-sm font-medium">Mobile</label><input id="as-mobile" value={details.mobile} onChange={(e) => setDetails({ ...details, mobile: e.target.value })} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="as-purpose" className="text-sm font-medium">Profile / Purpose</label><input id="as-purpose" value={details.purpose} onChange={(e) => setDetails({ ...details, purpose: e.target.value })} required className={input} /></div>
          <div className="space-y-1">
            <label htmlFor="as-photo" className="text-sm font-medium">Photo</label>
            <input id="as-photo" type="file" accept="image/*" onChange={onPhoto} className="text-sm" />
            {photo && (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL preview, not a static/remote asset
              <img src={photo} alt="New photo preview" className="mt-1 h-14 w-14 rounded-full object-cover" />
            )}
          </div>
          <p className="text-xs text-gray-500">Username and email can’t be changed here.</p>
          <button type="submit" disabled={busy} className={`${btn} bg-gray-900 text-white`}>{busy ? 'Saving…' : 'Save details'}</button>
        </form>
      )}

      {panel === 'password' && (
        <form onSubmit={changePassword} className="space-y-3 rounded border border-gray-200 bg-white p-4" aria-label="Change password">
          <div className="space-y-1"><label htmlFor="as-cur" className="text-sm font-medium">Current password</label><input id="as-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="as-new" className="text-sm font-medium">New password</label><input id="as-new" type="password" autoComplete="new-password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="as-conf" className="text-sm font-medium">Repeat new password</label><input id="as-conf" type="password" autoComplete="new-password" minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required className={input} /></div>
          <p className="text-xs text-gray-500">At least 8 characters. Changing it signs you out on every other device.</p>
          <button type="submit" disabled={busy} className={`${btn} bg-gray-900 text-white`}>{busy ? 'Changing…' : 'Change password'}</button>
        </form>
      )}
    </div>
  );
}
