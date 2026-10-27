'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { checkMobile } from '@/lib/phone';
import { sendJson } from '@/lib/clientFetch';
import { PhotoInput } from '@/components/PhotoInput';
import { HumanCheck, humanCheckOn } from '@/components/HumanCheck';
import { PassReady, type IssuedPass } from '@/components/PassReady';
import { NextPerson, type KioskNext } from '@/components/NextPerson';

const EMPTY = { firstName: '', lastName: '', mobile: '', email: '', purpose: '', parentIdentifier: '' };

// Quick sign-up for an event link set to "Passwords: not needed" — built for phones and kiosks:
// big fields, no account, no password. What happens next is the event's setting (server-side):
// approved on the spot (pass shown / printed / emailed) or waiting for a Master.
export function QuickRegister({ token, source, emailPass, autoApprove, kiosk, kioskNext, kioskSeconds, header }: {
  token: string; source: Record<string, string>; emailPass: boolean; autoApprove: boolean; kiosk: boolean; kioskNext: KioskNext; kioskSeconds: number; header: ReactNode;
}) {
  const [f, setF] = useState(EMPTY);
  const [photo, setPhoto] = useState<string | null>(null);
  const [humanToken, setHumanToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; pass: IssuedPass | null } | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const mobile = f.mobile.trim() ? checkMobile(f.mobile) : null;
  const self = `/e/${token}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await sendJson<IssuedPass & { status: string; passToken: string | null }>(`/api/e/${token}/register`, { ...f, photoDataUrl: photo, source, humanToken });
      setDone({ name: f.firstName, pass: r.status === 'APPROVED' && r.passToken ? r : null });
      setF(EMPTY);
      setPhoto(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register — please try again.');
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base';
  const label = 'block space-y-1 text-sm font-medium';
  if (done) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-5 px-4 py-8">
        {header}
        {done.pass ? <PassReady pass={done.pass} name={done.name} nextHref={self} /> : (
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-5" role="status">
            <p className="text-lg font-bold">Thanks, {done.name} — you’re registered.</p>
            <p className="text-sm text-gray-700">The organisers will approve your registration{emailPass ? '; your pass is emailed to you then (if you gave an email)' : ''}.</p>
            {kiosk && <NextPerson href={self} mode={kioskNext} seconds={kioskSeconds} />}
          </div>
        )}
      </main>
    );
  }
  return (
    <main className="mx-auto w-full max-w-lg space-y-5 px-4 py-8">
      {header}
      <form onSubmit={submit} className="space-y-4" aria-label="Quick registration" data-testid="quick-register">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}><span>First name</span><input value={f.firstName} onChange={set('firstName')} required autoComplete="given-name" className={input} /></label>
          <label className={label}><span>Last name</span><input value={f.lastName} onChange={set('lastName')} required autoComplete="family-name" className={input} /></label>
        </div>
        <label className={label}><span>Mobile number</span>
          <input type="tel" value={f.mobile} onChange={set('mobile')} required autoComplete="tel" placeholder="98765 43210" className={`${input} ${mobile && !mobile.ok ? 'border-red-400' : ''}`} />
          {mobile && !mobile.ok && <span className="block text-xs font-normal text-red-700">{mobile.message}</span>}</label>
        <label className={label}><span>Email <span className="font-normal text-gray-500">(optional{emailPass ? ' — we send your pass here' : ''})</span></span>
          <input type="email" value={f.email} onChange={set('email')} autoComplete="email" className={input} /></label>
        <label className={label}><span>Organisation / purpose <span className="font-normal text-gray-500">(optional)</span></span>
          <input value={f.purpose} onChange={set('purpose')} maxLength={200} className={input} /></label>
        <label className={label}><span>Employee you’re coming with <span className="font-normal text-gray-500">(optional — username or access code)</span></span>
          <input value={f.parentIdentifier} onChange={set('parentIdentifier')} autoComplete="off" className={input} /></label>
        <PhotoInput value={photo} onChange={setPhoto} hint="optional — printed on your pass and shown to the guard" />
        <HumanCheck onToken={setHumanToken} />
        {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
        <button type="submit" disabled={busy || (mobile !== null && !mobile.ok) || (humanCheckOn && !humanToken)}
          className="flex min-h-12 w-full items-center justify-center rounded-lg bg-[#0D5B7A] text-base font-semibold text-white disabled:opacity-50">
          {busy ? 'Registering…' : autoApprove ? 'Register and get my pass' : 'Register'}
        </button>
        <p className="text-xs text-gray-500">No password needed. Your name, mobile{f.email ? ', email' : ''} and photo (if added) are kept by EDC for this event’s entry records.</p>
      </form>
    </main>
  );
}
