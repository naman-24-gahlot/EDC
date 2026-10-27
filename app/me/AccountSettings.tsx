'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PhotoInput } from '@/components/PhotoInput';
import { sendJson } from '@/lib/clientFetch';
import { PasswordField, type PasswordVerdict } from '@/components/PasswordField';

type Panel = 'details' | 'password' | 'photo' | 'delete' | null;

const input = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';
const btn = 'rounded px-3 py-2 text-sm font-medium disabled:opacity-50';

export function AccountSettings({ initial, username, photo: savedPhoto }: { initial: { firstName: string; lastName: string; mobile: string; purpose: string; backupEmail: string }; username: string; photo: string | null }) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [details, setDetails] = useState(initial);
  const [photo, setPhoto] = useState<string | null>(savedPhoto);
  const [del, setDel] = useState({ password: '', confirm: '' });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [pwVerdict, setPwVerdict] = useState<PasswordVerdict>('blocked');

  async function send(method: string, url: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await sendJson(url, body, method); // plain-language messages for offline / timeouts / ended sessions
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
    if (Object.keys(patch).length === 0) return setMessage({ ok: false, text: 'Nothing changed.' });
    if (await send('PATCH', '/api/me/profile', patch)) {
      setMessage({ ok: true, text: 'Details saved.' });
      setPanel(null);
      router.refresh();
    }
  }

  async function savePhoto() {
    if (photo === savedPhoto) return setMessage({ ok: false, text: 'Nothing changed.' });
    if (await send('PATCH', '/api/me/profile', { photoDataUrl: photo })) {
      setMessage({ ok: true, text: photo ? 'Photo saved — guards see it at the gate.' : 'Photo removed.' });
      setPanel(null);
      router.refresh();
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (del.confirm !== 'DELETE') return setMessage({ ok: false, text: 'Type DELETE in capitals to confirm.' });
    if (await send('DELETE', '/api/me/account', { password: del.password, confirm: 'DELETE' })) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full load: the session is gone
      window.location.assign('/login?deleted=1');
    }
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
        <button type="button" onClick={() => setPanel(panel === 'photo' ? null : 'photo')} aria-expanded={panel === 'photo'} className={`${btn} border border-gray-300 bg-white`}>{savedPhoto ? 'Change photo' : 'Add photo'}</button>
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
      {panel !== 'delete' && (
        <button type="button" onClick={() => setPanel('delete')} className="inline-flex min-h-10 items-center text-xs text-red-700 underline md:min-h-0">Delete my account…</button>
      )}

      {panel === 'delete' && (
        <form onSubmit={deleteAccount} className="space-y-3 rounded border border-red-200 bg-red-50 p-4" aria-label="Delete my account">
          <p className="text-sm font-semibold text-red-900">Delete my account permanently</p>
          <p className="text-sm text-red-900">This removes your sign-in, profile, photo, access code, access history, gate records, leave and emails from EDC for good. It can’t be undone; to come back you’d register again. The audit log keeps that an account was deleted, with your details removed.</p>
          <div className="space-y-1"><label htmlFor="del-pw" className="text-sm font-medium">Your password</label><input id="del-pw" type="password" autoComplete="current-password" value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="del-confirm" className="text-sm font-medium">Type <b>DELETE</b> to confirm</label><input id="del-confirm" value={del.confirm} onChange={(e) => setDel({ ...del, confirm: e.target.value })} autoCapitalize="characters" autoComplete="off" required className={input} /></div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || del.confirm !== 'DELETE' || !del.password} className={`${btn} bg-red-700 text-white`}>{busy ? 'Deleting…' : 'Delete my account'}</button>
            <button type="button" onClick={() => { setDel({ password: '', confirm: '' }); setPanel(null); }} className={`${btn} border border-gray-300 bg-white`}>Cancel</button>
          </div>
        </form>
      )}

      {panel === 'details' && (
        <form onSubmit={saveDetails} className="space-y-3 rounded border border-gray-200 bg-white p-4" aria-label="Edit my details">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label htmlFor="as-first" className="text-sm font-medium">First name</label><input id="as-first" value={details.firstName} onChange={(e) => setDetails({ ...details, firstName: e.target.value })} required className={input} /></div>
            <div className="space-y-1"><label htmlFor="as-last" className="text-sm font-medium">Last name</label><input id="as-last" value={details.lastName} onChange={(e) => setDetails({ ...details, lastName: e.target.value })} required className={input} /></div>
          </div>
          <div className="space-y-1"><label htmlFor="as-mobile" className="text-sm font-medium">Mobile</label><input id="as-mobile" value={details.mobile} onChange={(e) => setDetails({ ...details, mobile: e.target.value })} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="as-purpose" className="text-sm font-medium">Profile / Purpose</label><input id="as-purpose" value={details.purpose} onChange={(e) => setDetails({ ...details, purpose: e.target.value })} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="as-backup" className="text-sm font-medium">Backup email <span className="font-normal text-gray-500">(optional — also gets password-reset links and approval emails; leave empty to remove)</span></label><input id="as-backup" type="email" value={details.backupEmail} onChange={(e) => setDetails({ ...details, backupEmail: e.target.value })} className={input} /></div>
          <p className="text-xs text-gray-500">Username and email can’t be changed here.</p>
          <button type="submit" disabled={busy} className={`${btn} bg-gray-900 text-white`}>{busy ? 'Saving…' : 'Save details'}</button>
        </form>
      )}

      {panel === 'photo' && (
        <div className="space-y-3 rounded border border-gray-200 bg-white p-4" aria-label="My photo">
          <PhotoInput value={photo} onChange={setPhoto} label="My photo" hint="guards see it at the gate" />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={savePhoto} disabled={busy || photo === savedPhoto} className={`${btn} bg-gray-900 text-white`}>{busy ? 'Saving…' : 'Save photo'}</button>
            <button type="button" onClick={() => { setPhoto(savedPhoto); setPanel(null); }} className={`${btn} border border-gray-300`}>Cancel</button>
          </div>
        </div>
      )}

      {panel === 'password' && (
        <form onSubmit={changePassword} className="space-y-3 rounded border border-gray-200 bg-white p-4" aria-label="Change password">
          {/* Tells the browser's password manager WHICH account this new password belongs to.
              Without it, browsers saved the new password against another saved account (e.g. Master). */}
          <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
          <div className="space-y-1"><label htmlFor="as-cur" className="text-sm font-medium">Current password</label><input id="as-cur" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required className={input} /></div>
          <PasswordField id="as-new" label="New password" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} ctx={{ username, name: `${initial.firstName} ${initial.lastName}` }} onVerdict={setPwVerdict} />
          <div className="space-y-1"><label htmlFor="as-conf" className="text-sm font-medium">Repeat new password</label><input id="as-conf" type="password" autoComplete="new-password" minLength={8} value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required className={input} /></div>
          <p className="text-xs text-gray-500">At least 8 characters. Changing it signs you out on every other device.</p>
          <button type="submit" disabled={busy || pwVerdict !== 'ok' || pw.next !== pw.confirm || !pw.current} className={`${btn} bg-gray-900 text-white`}>{busy ? 'Changing…' : 'Change password'}</button>
        </form>
      )}
    </div>
  );
}
