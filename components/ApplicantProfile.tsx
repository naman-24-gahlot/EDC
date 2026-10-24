'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';

const TYPE: Record<string, string> = { employee: 'Employee', incubee: 'Incubee', event_guest: 'Event Guest', driver: 'Driver', relative: 'Relative', bodyguard: 'Bodyguard' };

interface Profile {
  firstName: string; lastName: string; username: string; commEmail: string | null; emailVerified: boolean;
  mobile: string | null; purpose: string | null; photoDataUrl: string | null; profileType: string | null; appliedAs: string | null;
  parentName: string | null; eventName: string | null; registrationStatus: string; registeredAt: string | null;
}

// "View profile" next to a request someone has to decide on: everything the person gave us, with
// their photo, loaded only when opened (so lists stay light). The server decides who may see it
// (GET /api/people/[id]: Master or an ancestor) and who may edit it (PATCH: the same).
export function ApplicantProfile({ personId, label = 'View profile' }: { personId: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', mobile: '', purpose: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const data = await sendJson<Profile>(`/api/people/${personId}`, undefined, 'GET');
      setP(data);
      setForm({ firstName: data.firstName, lastName: data.lastName, mobile: data.mobile ?? '', purpose: data.purpose ?? '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the profile.');
    }
  }

  async function toggle() {
    if (!open && !p) await load();
    setOpen(!open);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!p) return;
    const patch = Object.fromEntries(Object.entries(form).filter(([k, v]) => v.trim() !== String(p[k as keyof Profile] ?? '')));
    if (Object.keys(patch).length === 0) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/api/people/${personId}`, patch, 'PATCH');
      await load();
      setEditing(false);
      setSaved('Saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  const row = (k: string, v: React.ReactNode) => (
    <div className="flex flex-wrap justify-between gap-x-3 border-b border-dashed border-gray-200 py-1 last:border-0">
      <dt className="text-gray-500">{k}</dt><dd className="min-w-0 break-words text-right font-medium">{v}</dd>
    </div>
  );
  const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';

  return (
    <div className="space-y-2">
      <button type="button" onClick={toggle} aria-expanded={open} className="inline-flex min-h-10 items-center gap-1 text-xs font-semibold text-[#0D5B7A] underline underline-offset-2 md:min-h-0">
        {open ? 'Hide profile' : label}
      </button>
      {open && (
        <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 text-sm text-gray-900" data-testid="applicant-profile">
          {error && <p className="text-red-700" role="alert">{error}</p>}
          {!p ? (!error && <p className="text-gray-500">Loading…</p>) : (
            <>
              <div className="flex items-start gap-3">
                {p.photoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data: URL from the person record
                  <img src={p.photoDataUrl} alt={`Photo of ${p.firstName} ${p.lastName}`} className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-center text-xs text-gray-500">No photo</div>
                )}
                <div className="min-w-0">
                  <p className="text-base font-semibold">{p.firstName} {p.lastName}</p>
                  <p className="text-xs text-gray-500">@{p.username}</p>
                  <p className="mt-1 text-xs">{p.registrationStatus === 'PENDING' ? 'Waiting for approval' : p.registrationStatus.toLowerCase()}</p>
                </div>
              </div>
              {editing ? (
                <form onSubmit={save} className="grid gap-2 sm:grid-cols-2" aria-label="Edit details">
                  {(['firstName', 'lastName', 'mobile', 'purpose'] as const).map((k) => (
                    <label key={k} className="space-y-1 text-xs font-semibold uppercase text-gray-500">
                      <span className="block">{{ firstName: 'First name', lastName: 'Last name', mobile: 'Mobile', purpose: 'Purpose' }[k]}</span>
                      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required className={`${input} font-normal normal-case text-gray-900`} />
                    </label>
                  ))}
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="submit" disabled={busy} className="min-h-10 rounded bg-gray-900 px-3 text-sm font-medium text-white disabled:opacity-50 md:min-h-8">{busy ? 'Saving…' : 'Save changes'}</button>
                    <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded border border-gray-300 px-3 text-sm md:min-h-8">Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <dl className="text-sm">
                    {row('Email', <>{p.commEmail ?? '—'} {p.emailVerified ? <span className="text-emerald-700">✓ confirmed</span> : <span className="text-amber-700">not confirmed</span>}</>)}
                    {row('Mobile', p.mobile ?? '—')}
                    {row('Purpose', p.purpose ?? '—')}
                    {row('Type', p.appliedAs && p.appliedAs !== p.profileType ? <>{TYPE[p.profileType ?? ''] ?? '—'} <span className="text-xs text-gray-500">(applied as {TYPE[p.appliedAs] ?? p.appliedAs})</span></> : TYPE[p.profileType ?? ''] ?? 'Guard')}
                    {row('Under', p.parentName ?? 'nobody (top-level)')}
                    {p.eventName && row('Event', p.eventName)}
                    {row('Registered', p.registeredAt ? new Date(p.registeredAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')}
                  </dl>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => { setEditing(true); setSaved(null); }} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-xs font-medium md:min-h-8">Edit details</button>
                    {saved && <span className="text-xs text-emerald-700" role="status">{saved}</span>}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
