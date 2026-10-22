'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';
import { InfoTip } from '@/components/InfoTip';

interface Window { startDate: string; endDate: string | null; weekdays: number[]; startTime: string; endTime: string }
type Details = { firstName: string; lastName: string; mobile: string; purpose: string };
type Msg = { ok: boolean; text: string } | null;

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
  /** Default access period per profile type, starting today. */
  templates: Record<string, Window>;
  /** Why access can't be granted right now (not approved / deactivated), or null. */
  grantBlocked: string | null;
  /** The ACTIVE entitlement, if any, and its computed status (ACTIVE / SCHEDULED / EXPIRED). */
  current: { id: string; status: string; window: Window } | null;
  details: Details;
}

const TYPES = [
  ['employee', 'Employee'], ['incubee', 'Incubee'], ['event_guest', 'Event Guest'],
  ['driver', 'Driver'], ['relative', 'Relative'], ['bodyguard', 'Bodyguard'],
] as const;
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPES);
const SUBORDINATE = new Set(['driver', 'relative', 'bodyguard', 'event_guest']);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOP_LEVEL = '__top__';
const btn = 'inline-flex min-h-10 items-center rounded border px-3 text-sm font-medium disabled:opacity-50 md:min-h-8';
const label = 'text-xs font-semibold uppercase text-gray-500';
const input = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm';

const sameWindow = (a: Window, b: Window) =>
  a.startDate === b.startDate && a.endDate === b.endDate && a.startTime === b.startTime &&
  a.endTime === b.endTime && a.weekdays.join() === b.weekdays.join();

function describe(w: Window) {
  const days = w.weekdays.length === 7 ? 'every day' : w.weekdays.map((d) => DAYS[d]).join(' ');
  return `${w.endDate ? `${w.startDate} → ${w.endDate}` : `from ${w.startDate}, open-ended`} · ${days} · ${w.startTime}–${w.endTime}`;
}

// Plain-language failures for offline / timeouts / an ended session (lib/clientFetch.ts).
const send = (url: string, body: unknown, method = 'POST') => sendJson<{ password?: string }>(url, body ?? {}, method);

function WindowFields({ value, onChange }: { value: Window; onChange: (w: Window) => void }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1"><label htmlFor="ax-start" className={label}>From</label>
          <input id="ax-start" type="date" value={value.startDate} onChange={(e) => onChange({ ...value, startDate: e.target.value })} className={input} required /></div>
        <div className="space-y-1"><label htmlFor="ax-end" className={label}>Until <span className="font-normal normal-case">(empty = open-ended)</span></label>
          <input id="ax-end" type="date" value={value.endDate ?? ''} onChange={(e) => onChange({ ...value, endDate: e.target.value || null })} className={input} /></div>
        <div className="space-y-1"><label htmlFor="ax-from" className={label}>Gate opens</label>
          <input id="ax-from" type="time" value={value.startTime} onChange={(e) => onChange({ ...value, startTime: e.target.value })} className={input} required /></div>
        <div className="space-y-1"><label htmlFor="ax-to" className={label}>Gate closes</label>
          <input id="ax-to" type="time" value={value.endTime} onChange={(e) => onChange({ ...value, endTime: e.target.value })} className={input} required /></div>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Days allowed">
        {DAYS.map((d, i) => {
          const on = value.weekdays.includes(i);
          return (
            <button type="button" key={d} aria-pressed={on}
              onClick={() => onChange({ ...value, weekdays: on ? value.weekdays.filter((x) => x !== i) : [...value.weekdays, i].sort() })}
              className={`min-h-10 min-w-11 rounded px-2 py-1 text-xs font-semibold md:min-h-0 md:min-w-0 ${on ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-300'}`}>
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One form for everything about the person record: details, profile type, parent. */
function ProfileForm({ person, eligibleParents, templates, details, current, setMsg }: Props & { setMsg: (m: Msg) => void }) {
  const router = useRouter();
  const [info, setInfo] = useState(details);
  const [type, setType] = useState(person.profileType ?? '');
  const [parent, setParent] = useState(person.parentId ?? TOP_LEVEL);
  const [busy, setBusy] = useState(false);
  const isMember = person.systemRole === 'member' && !!person.profileType;
  const base = `/api/people/${person.personId}`;

  const changedDetails = Object.fromEntries(Object.entries(info).filter(([k, v]) => v.trim() !== details[k as keyof Details]));
  const typeChanged = isMember && type !== person.profileType;
  const parentChanged = isMember && parent !== (person.parentId ?? TOP_LEVEL);
  const dirty = Object.keys(changedDetails).length > 0 || typeChanged || parentChanged;
  // Becoming employee/incubee moves them to top-level on the server, so don't also send a move.
  const movesToTop = typeChanged && !SUBORDINATE.has(type) && SUBORDINATE.has(person.profileType ?? '');

  async function save(e: FormEvent) {
    e.preventDefault();
    if (typeChanged) {
      const access = current && current.status !== 'EXPIRED'
        ? `Their access is replaced by the ${TYPE_LABEL[type]} default (${describe(templates[type])}).`
        : 'They have no access in force, so none is granted — use the access form after saving.';
      if (!window.confirm(`Change ${person.name} to ${TYPE_LABEL[type]}?\n\nTheir code prefix changes (the old code stops working) and every QR they hold stops working. ${access}`)) return;
    }
    setBusy(true);
    setMsg(null);
    const done: string[] = [];
    try {
      if (Object.keys(changedDetails).length) { await send(base, changedDetails, 'PATCH'); done.push('details'); }
      const move = parentChanged && !(movesToTop && parent === TOP_LEVEL) ? () => send(`${base}/parent`, { parentId: parent === TOP_LEVEL ? null : parent }) : null;
      // A subordinate type needs its parent first; anything else changes type first.
      if (move && SUBORDINATE.has(type)) { await move(); done.push('parent'); }
      if (typeChanged) { await send(`${base}/profile-type`, { profileType: type }); done.push('profile type'); }
      if (move && !SUBORDINATE.has(type)) { await move(); done.push('parent'); }
      setMsg({ ok: true, text: `Saved: ${done.join(', ')}.` });
    } catch (err) {
      setMsg({ ok: false, text: `${done.length ? `Saved ${done.join(', ')}, but then: ` : ''}${err instanceof Error ? err.message : 'Could not save.'}` });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4" aria-label="Profile">
      <h3 className="text-sm font-semibold">Profile</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['firstName', 'lastName', 'mobile', 'purpose'] as const).map((k) => (
          <div key={k} className="space-y-1">
            <label htmlFor={`pf-${k}`} className={label}>{{ firstName: 'First name', lastName: 'Last name', mobile: 'Mobile', purpose: 'Profile / purpose' }[k]}</label>
            <input id={`pf-${k}`} value={info[k]} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} required className={input} />
          </div>
        ))}
        {isMember && (
          <>
            <div className="space-y-1">
              <label htmlFor="pf-type" className={label}>Profile type</label>
              <select id="pf-type" value={type} onChange={(e) => setType(e.target.value)} className={input}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="pf-parent" className={label}>Parent</label>
              <select id="pf-parent" value={movesToTop ? TOP_LEVEL : parent} disabled={movesToTop} onChange={(e) => setParent(e.target.value)} className={`${input} disabled:bg-gray-100`}>
                <option value={TOP_LEVEL}>— top-level (under Master) —</option>
                {eligibleParents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </>
        )}
      </div>
      {typeChanged && (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900" data-testid="type-change-note">
          As {TYPE_LABEL[type]}: new code prefix, old QRs stop working
          {current && current.status !== 'EXPIRED' ? <>, access becomes the {TYPE_LABEL[type]} default — <b>{describe(templates[type])}</b></> : ', no access is granted automatically (none is in force now)'}
          {movesToTop && ', and they move to top-level'}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!dirty || busy} className={`${btn} border-gray-900 bg-gray-900 text-white`}>{busy ? 'Saving…' : 'Save changes'}</button>
        {dirty && !busy && (
          <button type="button" className={`${btn} border-gray-300`} onClick={() => { setInfo(details); setType(person.profileType ?? ''); setParent(person.parentId ?? TOP_LEVEL); }}>Undo</button>
        )}
      </div>
    </form>
  );
}

/**
 * One form for the access period. With access on record it edits that period in place (same
 * pass, applies at the gate immediately); without, saving grants a new one.
 */
function AccessForm({ person, templates, grantBlocked, current, setMsg }: Props & { setMsg: (m: Msg) => void }) {
  const router = useRouter();
  const typeDefault = templates[person.profileType ?? ''];
  const start = current?.window ?? typeDefault;
  const [w, setW] = useState(start);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'save' | 'revoke' | null>(null);
  const dirty = !current || !sameWindow(w, current.window);
  const typeName = TYPE_LABEL[person.profileType ?? ''] ?? '';

  async function run(kind: 'save' | 'revoke', fn: () => Promise<unknown>, ok: string) {
    setBusy(kind);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (current) run('save', () => send(`/api/entitlements/${current.id}`, w, 'PATCH'), 'Access updated — applies at the gate immediately, same pass.');
    else run('save', () => send(`/api/people/${person.personId}/entitlements`, w), 'Access granted.');
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4" aria-label="Access period">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Access period</h3>
        <p className="text-xs text-gray-500" data-testid="access-summary">
          {current ? <>Now: <b>{current.status}</b> · {describe(current.window)}</> : 'No access in force — saving grants new access.'}
        </p>
      </div>
      {grantBlocked && !current ? (
        <p className="text-sm text-gray-500">{grantBlocked}</p>
      ) : (
        <>
          <WindowFields value={w} onChange={setW} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={!!busy || !dirty || w.weekdays.length === 0} className={`${btn} border-emerald-700 bg-emerald-700 text-white`}>
              {busy === 'save' ? 'Saving…' : current ? 'Save changes' : 'Grant access'}
            </button>
            {typeDefault && !sameWindow(w, typeDefault) && (
              <span className="inline-flex items-center">
                <button type="button" className={`${btn} border-gray-300`} disabled={!!busy} onClick={() => setW(typeDefault)}>
                  Use {typeName} default
                </button>
                <InfoTip label={`Use ${typeName} default`}>Fills the form with the usual period for a {typeName}: {describe(typeDefault)}. Nothing is saved until you press the green button.</InfoTip>
              </span>
            )}
            {current && dirty && <button type="button" className={`${btn} border-gray-300`} disabled={!!busy} onClick={() => setW(current.window)}>Undo</button>}
          </div>
          {w.weekdays.length === 0 && <p className="text-xs text-red-700">Pick at least one day.</p>}
        </>
      )}
      {current && (
        <div className="flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3">
          <div className="min-w-0 flex-1 basis-48 space-y-1">
            <span className="flex items-center"><label htmlFor="ax-reason" className={label}>Revoke access</label><InfoTip label="Revoke access" align="left">Ends this access period now: the gate refuses them (&quot;Access revoked&quot;). Their account stays on, so they can sign in and request access again. Granting new access later gives them a new QR.</InfoTip></span>
            <input id="ax-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className={input} />
          </div>
          <button type="button" className={`${btn} border-red-300 text-red-700`} disabled={!!busy}
            onClick={() => window.confirm(`End ${person.name}'s access period now?

The gate refuses them from now on ("Access revoked"). Their account stays on, so they can still sign in and request access again; granting new access later gives them a new QR.`) &&
              run('revoke', () => send(`/api/entitlements/${current.id}/revoke`, { reason }), `${person.name}'s access period has ended. Grant new access here any time.`)}>
            {busy === 'revoke' ? 'Revoking…' : 'Revoke access'}
          </button>
        </div>
      )}
    </form>
  );
}

// One thing the person has (account, QR, password, role): its state, the action, and an "i"
// explaining exactly what the action does.
function ActionRow({ label, state, action, help, children }: { label: string; state: string; action: string; help: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3">
      <dt className="min-w-0 flex-1 basis-56 font-medium">{label} <span className="font-normal text-gray-500">· {state}</span></dt>
      <dd className="flex shrink-0 items-center gap-0.5">{children}<InfoTip label={action}>{help}</InfoTip></dd>
    </div>
  );
}

// Every action here is Master-only on the server; this component only sends the request
// and shows the outcome. Nothing it hides or shows is an authorization decision.
export function PersonActions(props: Props) {
  const { person, details, current } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [oneTimePassword, setOneTimePassword] = useState<string | null>(null);
  const base = `/api/people/${person.personId}`;
  const approved = person.registrationStatus === 'APPROVED';

  async function act(url: string, confirmText: string | null, done: string) {
    if (confirmText && !window.confirm(confirmText)) return null;
    setBusy(true);
    setMsg(null);
    try {
      const data = await send(url, {});
      setMsg({ ok: true, text: done });
      router.refresh();
      return data;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Action failed' });
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (person.isSelf) {
    return <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">This is you. Masters can&apos;t change their own role, status or hierarchy — another Master has to. Edit your own details from <Link href="/me" className="underline">My account</Link>.</p>;
  }

  // Remounting a form on new server data resets it to what's saved — no stale edits after a refresh.
  const profileKey = JSON.stringify([details, person.profileType, person.parentId]);
  const accessKey = JSON.stringify([person.profileType, current]);

  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-4" data-testid="person-actions">
      {msg && <p role="status" className={`rounded p-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>{msg.text}</p>}

      {/* One row per thing an action changes, each with what it does — so similar-sounding
          actions (deactivate vs revoke, replace QR vs reactivate) can't be confused. */}
      <dl className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white text-sm">
        {approved && (
          <ActionRow label="Account" state={person.active ? 'On — can sign in and use the gate' : 'Switched off — cannot sign in or enter'} action={person.active ? 'Deactivate account' : 'Reactivate account'}
            help={person.active
              ? 'Deactivating signs them out everywhere and stops sign-in and gate entry. Their profile, access period and history are kept; Reactivate undoes it.'
              : 'Reactivating lets them sign in again; their access period (if still valid) applies again. QRs from before deactivation stay cancelled — their pass shows a new one.'}>
            {person.active ? (
              <button className={`${btn} border-red-300 text-red-700`} disabled={busy}
                onClick={() => act(`${base}/deactivate`, `Deactivate ${person.name}'s account?

They are signed out everywhere and can't sign in or enter the gate until reactivated. Nothing is deleted.`, `${person.name}'s account is switched off. Reactivate it any time.`)}>
                Deactivate account
              </button>
            ) : (
              <button className={`${btn} border-emerald-400 text-emerald-800`} disabled={busy}
                onClick={() => act(`${base}/reactivate`, null, `${person.name}'s account is on again. They can sign in; their pass shows a new QR.`)}>
                Reactivate account
              </button>
            )}
          </ActionRow>
        )}
        {person.systemRole !== 'guard' && approved && person.active && (
          <ActionRow label="Entry pass QR" state="Their access code stays the same" action="Replace QR code"
            help="Use when a QR screenshot was shared or a phone was lost: every QR they've shown or saved stops working, and their pass shows a new one. Their access period and code don't change.">
            <button className={`${btn} border-amber-300 text-amber-800`} disabled={busy}
              onClick={() => act(`${base}/reissue`, `Replace ${person.name}'s QR code?

Every QR they've shown or screenshotted stops working. Their pass shows the new one; access and code don't change.`, `New QR issued for ${person.name}. Old QRs are refused at the gate as "Old QR (replaced)".`)}>
              Replace QR code
            </button>
          </ActionRow>
        )}
        <ActionRow label="Password" state="Only they know it" action="Reset password"
          help="Gives you a one-time password to hand over. They are signed out everywhere, and must choose a new password (not the one-time one, not their old one) when they sign in with it.">
          <button className={`${btn} border-gray-400`} disabled={busy}
            onClick={async () => { const d = await act(`${base}/reset-password`, `Reset ${person.name}'s password?

They are signed out everywhere. You'll get a one-time password to give them.`, `Password reset for ${person.name}. Give them the one-time password below.`); if (d?.password) setOneTimePassword(d.password); }}>
            Reset password
          </button>
        </ActionRow>
        {(person.systemRole === 'master' || (person.systemRole === 'member' && person.profileType === 'employee' && approved && person.active)) && (
          <ActionRow label="Role" state={person.systemRole === 'master' ? 'Master — full control of everyone' : 'Member'} action={person.systemRole === 'master' ? 'Remove Master' : 'Make Master'}
            help={person.systemRole === 'master'
              ? 'Removing Master makes them a normal employee again and signs them out.'
              : person.parentId !== null ? 'Only a top-level employee can become Master — set their parent to top-level in Profile first.' : 'A Master can manage everyone and everything here, including other Masters.'}>
            {person.systemRole === 'master' ? (
              <button className={`${btn} border-purple-300 text-purple-800`} disabled={busy}
                onClick={() => act(`${base}/demote`, `Remove Master from ${person.name}?

They become a normal employee and are signed out.`, `${person.name} is no longer a Master.`)}>
                Remove Master
              </button>
            ) : (
              <button className={`${btn} border-purple-300 text-purple-800`} disabled={busy || person.parentId !== null}
                onClick={() => act(`${base}/promote`, `Make ${person.name} a Master?

They get full control of everyone and everything here.`, `${person.name} is now a Master. They get Master pages next time they sign in.`)}>
                Make Master
              </button>
            )}
          </ActionRow>
        )}
      </dl>

      {oneTimePassword && (
        <div role="status" className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
          One-time password for {person.name}: <span className="font-mono font-semibold">{oneTimePassword}</span>
          <span className="block text-xs text-gray-600">Shown once — hand it over now. When they sign in with it, they must choose a new password (not this one, not their old one) before anything else.</span>
          <button type="button" className="mt-1 text-xs underline" onClick={() => setOneTimePassword(null)}>Hide</button>
        </div>
      )}

      <ProfileForm key={profileKey} {...props} setMsg={setMsg} />
      {person.profileType && <AccessForm key={accessKey} {...props} setMsg={setMsg} />}
    </div>
  );
}
