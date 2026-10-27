'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PhotoInput } from '@/components/PhotoInput';

const TYPES = [
  { value: 'driver', label: 'Driver' },
  { value: 'relative', label: 'Relative' },
  { value: 'bodyguard', label: 'Bodyguard' },
  { value: 'event_guest', label: 'Event Guest' },
] as const;

interface Created {
  name: string;
  username: string;
  password: string;
  accessCode: string | null;
}

const EMPTY = { firstName: '', lastName: '', username: '', commEmail: '', mobile: '', purpose: '' };

export function CreatePersonForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profileType, setProfileType] = useState<string>('driver');
  const [fields, setFields] = useState(EMPTY);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const set = (key: keyof typeof EMPTY) => (e: ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [key]: e.target.value });


  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, profileType, photoDataUrl }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Could not create person');
      setCreated({ name: `${fields.firstName} ${fields.lastName}`, username: data.username, password: data.password, accessCode: data.accessCode });
      setFields(EMPTY);
      setPhotoDataUrl(null);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create person');
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded border border-gray-300 px-3 py-2 text-sm';

  return (
    <div className="space-y-3">
      {created && (
        <div role="status" className="space-y-1 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold">{created.name} was added and approved.</p>
          <p>Access code: <span className="font-mono font-semibold">{created.accessCode}</span></p>
          <p>Sign-in: <span className="font-mono">{created.username}</span> / <span className="font-mono">{created.password}</span></p>
          <p className="text-xs text-gray-600">This password is shown only once — pass it on now. They don&apos;t have gate access yet — use “Grant access” next to their name below.</p>
          <button onClick={() => setCreated(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}

      {!open ? (
        <button onClick={() => setOpen(true)} className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white">
          Create person under me
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded border border-gray-200 bg-white p-4">
          <div className="space-y-1">
            <label htmlFor="cp-type" className="text-sm font-medium">Profile type</label>
            <select id="cp-type" value={profileType} onChange={(e) => setProfileType(e.target.value)} className={input}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><label htmlFor="cp-first" className="text-sm font-medium">First name</label><input id="cp-first" value={fields.firstName} onChange={set('firstName')} required className={input} /></div>
            <div className="space-y-1"><label htmlFor="cp-last" className="text-sm font-medium">Last name</label><input id="cp-last" value={fields.lastName} onChange={set('lastName')} required className={input} /></div>
          </div>
          <div className="space-y-1"><label htmlFor="cp-user" className="text-sm font-medium">Username</label><input id="cp-user" value={fields.username} onChange={set('username')} required placeholder="letters, numbers, . _ -" className={input} /></div>
          <div className="space-y-1"><label htmlFor="cp-email" className="text-sm font-medium">Communication email</label><input id="cp-email" type="email" value={fields.commEmail} onChange={set('commEmail')} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="cp-mobile" className="text-sm font-medium">Mobile number</label><input id="cp-mobile" value={fields.mobile} onChange={set('mobile')} required className={input} /></div>
          <div className="space-y-1"><label htmlFor="cp-purpose" className="text-sm font-medium">Profile / Purpose</label><input id="cp-purpose" value={fields.purpose} onChange={set('purpose')} required className={input} /></div>
          <PhotoInput value={photoDataUrl} onChange={setPhotoDataUrl} label="Photo" hint="optional — guards see it at the gate" />
          <p className="text-xs text-gray-500">They&apos;re approved immediately (you are their approver) and get a one-time password to sign in.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setOpen(false)} disabled={busy} className="rounded border border-gray-300 px-3 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
