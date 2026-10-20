'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  person: {
    personId: string;
    name: string;
    isSelf: boolean;
    systemRole: 'master' | 'guard' | 'member';
    profileType: string | null;
    parentId: string | null;
    active: boolean;
    registrationStatus: string;
    hasDescendants: boolean;
  };
  eligibleParents: { id: string; name: string }[];
  template: Window | null;
  activeEntitlementId: string | null;
  activeWindow: Window | null;
  details: { firstName: string; lastName: string; mobile: string; purpose: string };
}

interface Window { startDate: string; endDate: string | null; weekdays: number[]; startTime: string; endTime: string }

function WindowFields({ value, onChange, idPrefix }: { value: Window; onChange: (w: Window) => void; idPrefix: string }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="date" aria-label="Start date" id={`${idPrefix}-start`} value={value.startDate} onChange={(e) => onChange({ ...value, startDate: e.target.value })} className="rounded border border-gray-300 px-2 py-1" required />
        <span>→</span>
        <input type="date" aria-label="End date" id={`${idPrefix}-end`} value={value.endDate ?? ''} onChange={(e) => onChange({ ...value, endDate: e.target.value || null })} className="rounded border border-gray-300 px-2 py-1" />
        <span className="text-xs text-gray-500">{value.endDate ? '' : 'open-ended'}</span>
        <input type="time" aria-label="Start time" id={`${idPrefix}-from`} value={value.startTime} onChange={(e) => onChange({ ...value, startTime: e.target.value })} className="rounded border border-gray-300 px-2 py-1" required />
        <span>–</span>
        <input type="time" aria-label="End time" id={`${idPrefix}-to`} value={value.endTime} onChange={(e) => onChange({ ...value, endTime: e.target.value })} className="rounded border border-gray-300 px-2 py-1" required />
      </div>
      <div className="flex flex-wrap gap-1">
        {DAYS.map((d, i) => {
          const on = value.weekdays.includes(i);
          return (
            <button type="button" key={d} aria-pressed={on}
              onClick={() => onChange({ ...value, weekdays: on ? value.weekdays.filter((x) => x !== i) : [...value.weekdays, i].sort() })}
              className={`rounded px-2 py-1 text-xs font-semibold ${on ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-300'}`}>
              {d}
            </button>
          );
        })}
      </div>
    </>
  );
}

const TYPES = [
  ['employee', 'Employee'], ['incubee', 'Incubee'], ['event_guest', 'Event Guest'],
  ['driver', 'Driver'], ['relative', 'Relative'], ['bodyguard', 'Bodyguard'],
] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOP_LEVEL = '__top__';

// Every action here is Master-only on the server; this component only sends the request
// and shows the outcome. Nothing it hides or shows is an authorization decision.
export function PersonActions({ person, eligibleParents, template, activeEntitlementId, activeWindow, details }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [newType, setNewType] = useState(person.profileType ?? 'employee');
  const [newParent, setNewParent] = useState(person.parentId ?? TOP_LEVEL);
  const [grant, setGrant] = useState(template);
  const [edit, setEdit] = useState(activeWindow);
  const [editFor, setEditFor] = useState(activeEntitlementId);
  if (editFor !== activeEntitlementId) {
    // A grant or revoke replaced the current period: reset the edit form to the new one.
    setEditFor(activeEntitlementId);
    setEdit(activeWindow);
  }
  const [editing, setEditing] = useState<'access' | 'details' | null>(null);
  const [info, setInfo] = useState(details);
  const [revokeReason, setRevokeReason] = useState('');
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);

  async function call(key: string, url: string, body: unknown, confirmText?: string, done?: string, method = 'POST') {
    if (confirmText && !window.confirm(confirmText)) return null;
    setBusy(key);
    setMessage(null);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Action failed');
      setMessage({ ok: true, text: done ?? 'Done.' });
      router.refresh();
      return data;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Action failed' });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function resetPassword() {
    const data = await call('reset', `${base}/reset-password`, {}, `Reset ${person.name}'s password? They are signed out everywhere and get a one-time password.`, 'Password reset.');
    if (data?.password) setOneTimePassword(data.password);
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!edit || !activeEntitlementId) return;
    call('edit', `/api/entitlements/${activeEntitlementId}`, edit, undefined, 'Access updated — takes effect at the gate immediately.', 'PATCH').then((d) => d && setEditing(null));
  }

  function submitDetails(e: FormEvent) {
    e.preventDefault();
    const patch = Object.fromEntries(Object.entries(info).filter(([k, v]) => v !== details[k as keyof typeof details]));
    if (Object.keys(patch).length === 0) return setMessage({ ok: false, text: 'Nothing changed.' });
    call('details', base, patch, undefined, 'Details saved.', 'PATCH').then((d) => d && setEditing(null));
  }

  const base = `/api/people/${person.personId}`;
  const isMember = person.systemRole === 'member';
  const approved = person.registrationStatus === 'APPROVED';
  const btn = 'rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-50';

  function submitGrant(e: FormEvent) {
    e.preventDefault();
    if (!grant) return;
    call('grant', `${base}/entitlements`, grant, undefined, 'Access granted.');
  }

  if (person.isSelf) {
    return <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">This is you. Masters can&apos;t change their own role, status or hierarchy — another Master has to.</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4" data-testid="person-actions">
      {message && <p role="status" className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-red-700'}`}>{message.text}</p>}

      <div className="flex flex-wrap gap-2">
        {approved && (person.active ? (
          <button className={`${btn} border-red-300 text-red-700`} disabled={!!busy}
            onClick={() => call('deactivate', `${base}/deactivate`, {}, `Deactivate ${person.name}? They are signed out, can't sign in, and every QR stops working.`, 'Deactivated.')}>
            Deactivate
          </button>
        ) : (
          <button className={`${btn} border-emerald-400 text-emerald-800`} disabled={!!busy}
            onClick={() => call('reactivate', `${base}/reactivate`, {}, undefined, 'Reactivated. Their old QR stays dead — the pass shows a new one.')}>
            Reactivate
          </button>
        ))}
        {person.systemRole === 'member' && person.profileType === 'employee' && approved && person.active && (
          <button className={`${btn} border-purple-300 text-purple-800`} disabled={!!busy || person.parentId !== null}
            title={person.parentId !== null ? 'Move them to top-level first' : undefined}
            onClick={() => call('promote', `${base}/promote`, {}, `Make ${person.name} a Master? They get full system-wide authority.`, 'Promoted to Master.')}>
            Promote to Master
          </button>
        )}
        {person.systemRole === 'master' && (
          <button className={`${btn} border-purple-300 text-purple-800`} disabled={!!busy}
            onClick={() => call('demote', `${base}/demote`, {}, `Remove Master from ${person.name}?`, 'Demoted to member.')}>
            Demote from Master
          </button>
        )}
        {person.systemRole !== 'guard' && approved && (
          <button className={`${btn} border-amber-300 text-amber-800`} disabled={!!busy}
            onClick={() => call('reissue', `${base}/reissue`, {}, `Reissue ${person.name}'s pass? Every QR they hold stops working.`, 'Pass reissued — old QRs no longer work.')}>
            Reissue credential
          </button>
        )}
        <button className={`${btn} border-gray-400`} disabled={!!busy} onClick={resetPassword}>Reset password</button>
        <button className={`${btn} border-gray-400`} disabled={!!busy} aria-expanded={editing === 'details'} onClick={() => setEditing(editing === 'details' ? null : 'details')}>Edit details</button>
      </div>

      {oneTimePassword && (
        <div role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
          One-time password for {person.name}: <span className="font-mono font-semibold">{oneTimePassword}</span>
          <span className="block text-xs text-gray-600">Shown once — hand it over now. They can change it from their account page.</span>
          <button type="button" className="mt-1 text-xs underline" onClick={() => setOneTimePassword(null)}>Hide</button>
        </div>
      )}

      {editing === 'details' && (
        <form onSubmit={submitDetails} className="grid gap-2 sm:grid-cols-2" aria-label="Edit details">
          {(['firstName', 'lastName', 'mobile', 'purpose'] as const).map((k) => (
            <div key={k} className="space-y-1">
              <label htmlFor={`pa-${k}`} className="text-xs font-semibold uppercase text-gray-500">{{ firstName: 'First name', lastName: 'Last name', mobile: 'Mobile', purpose: 'Profile / purpose' }[k]}</label>
              <input id={`pa-${k}`} value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} required className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </div>
          ))}
          <div className="sm:col-span-2"><button type="submit" disabled={!!busy} className={`${btn} border-gray-900 bg-gray-900 text-white`}>{busy === 'details' ? 'Saving…' : 'Save details'}</button></div>
        </form>
      )}

      {isMember && person.profileType && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="pa-type" className="text-xs font-semibold uppercase text-gray-500">Profile type</label>
            <div className="flex gap-2">
              <select id="pa-type" value={newType} onChange={(e) => setNewType(e.target.value)} className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm">
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button className={`${btn} border-gray-400`} disabled={!!busy || newType === person.profileType}
                onClick={() => call('type', `${base}/profile-type`, { profileType: newType },
                  `Change ${person.name} to ${newType}? Their code prefix changes (old code is rejected), every QR stops working, and their current access ends — grant new access afterwards.`, 'Profile type changed.')}>
                Change
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="pa-parent" className="text-xs font-semibold uppercase text-gray-500">Parent</label>
            <div className="flex gap-2">
              <select id="pa-parent" value={newParent} onChange={(e) => setNewParent(e.target.value)} className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm">
                <option value={TOP_LEVEL}>— top-level (under Master) —</option>
                {eligibleParents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className={`${btn} border-gray-400`} disabled={!!busy || newParent === (person.parentId ?? TOP_LEVEL)}
                onClick={() => call('rehome', `${base}/parent`, { parentId: newParent === TOP_LEVEL ? null : newParent }, undefined, 'Moved.')}>
                Move
              </button>
            </div>
          </div>
        </div>
      )}

      {activeEntitlementId && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="pa-revoke" className="text-xs font-semibold uppercase text-gray-500">Revoke current access</label>
            <input id="pa-revoke" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Reason (optional)" className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </div>
          <button className={`${btn} border-red-300 text-red-700`} disabled={!!busy}
            onClick={() => call('revoke', `/api/entitlements/${activeEntitlementId}/revoke`, { reason: revokeReason }, `Revoke ${person.name}'s access now? Their QR stops working too.`, 'Access revoked.')}>
            Revoke
          </button>
          {edit && (
            <button className={`${btn} border-gray-400`} disabled={!!busy} aria-expanded={editing === 'access'} onClick={() => setEditing(editing === 'access' ? null : 'access')}>
              Edit current access
            </button>
          )}
        </div>
      )}

      {editing === 'access' && edit && (
        <form onSubmit={submitEdit} className="space-y-2" aria-label="Edit current access">
          <p className="text-xs font-semibold uppercase text-gray-500">Edit current access <span className="font-normal normal-case">(same pass, rules apply at the gate immediately)</span></p>
          <WindowFields value={edit} onChange={setEdit} idPrefix="pa-edit" />
          <button type="submit" className={`${btn} border-gray-900 bg-gray-900 text-white`} disabled={!!busy || edit.weekdays.length === 0}>
            {busy === 'edit' ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      )}

      {grant && (
        <form onSubmit={submitGrant} className="space-y-2" aria-label="Grant access">
          <p className="text-xs font-semibold uppercase text-gray-500">Grant access {activeEntitlementId && <span className="font-normal normal-case">(replaces the current one)</span>}</p>
          <WindowFields value={grant} onChange={setGrant} idPrefix="pa-grant" />
          <button type="submit" className={`${btn} border-emerald-600 bg-emerald-700 text-white`} disabled={!!busy || grant.weekdays.length === 0}>
            {busy === 'grant' ? 'Granting…' : 'Grant'}
          </button>
        </form>
      )}
    </div>
  );
}
