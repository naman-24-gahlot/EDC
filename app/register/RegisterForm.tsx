'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { PasswordField } from '@/components/PasswordField';
import { PhotoInput } from '@/components/PhotoInput';
import { HumanCheck, humanCheckOn } from '@/components/HumanCheck';
import { checkMobile } from '@/lib/phone';
import { EmailConfirm } from './EmailConfirm';
import type { PasswordVerdict } from '@/components/PasswordField';

type Verdict = { ok: boolean; message: string | null };

/** Asks the server about a username or email shortly after typing stops (live hint only). */
function useLiveCheck(field: 'username' | 'email', value: string, minLength: number): Verdict | null {
  const [result, setResult] = useState<{ for: string; v: Verdict } | null>(null);
  useEffect(() => {
    const v = value.trim();
    if (v.length < minLength) return;
    const t = setTimeout(() => {
      fetch(`/api/register/check?${field}=${encodeURIComponent(v)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
        if (d?.[field]) setResult({ for: v, v: d[field] });
      }).catch(() => {}); // offline etc.: no hint, the submit still checks
    }, 450);
    return () => clearTimeout(t);
  }, [field, value, minLength]);
  return result && result.for === value.trim() ? result.v : null;
}

// The same mobile rule the server enforces (lib/phone.ts).
const mobileHint = (m: string): Verdict | null => (m.trim() ? checkMobile(m) : null);

const PROFILE_OPTIONS = [
  { value: 'employee', label: 'Employee' },
  { value: 'incubee', label: 'Incubee' },
  { value: 'event_guest', label: 'Event Guest' },
  { value: 'driver', label: 'Driver' },
  { value: 'relative', label: 'Relative' },
  { value: 'bodyguard', label: 'Bodyguard' },
] as const;

const SUBORDINATE_TYPES = new Set(['driver', 'relative', 'bodyguard', 'event_guest']);

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
  placeholder,
  hint,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  hint?: Verdict | null;
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={hint ? !hint.ok : undefined}
        className={`w-full rounded border px-3 py-2 text-sm ${hint && !hint.ok ? 'border-red-400' : 'border-gray-300'}`}
      />
      {hint?.message && <span className={`block text-xs ${hint.ok ? 'text-emerald-700' : 'text-red-700'}`} aria-live="polite">{hint.ok ? '✓ ' : ''}{hint.message}</span>}
    </label>
  );
}

export interface EventLink { token: string; name: string; source: { source?: string; medium?: string; campaign?: string } }

// The registration form, for the general page (/register) and for an event's link (/e/<token>).
export function RegisterForm({ event, header }: { event?: EventLink; header?: ReactNode }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [commEmail, setCommEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [backupEmail, setBackupEmail] = useState('');
  const [password, setPassword] = useState('');
  const [purpose, setPurpose] = useState('');
  const [profileType, setProfileType] = useState<string>(event ? 'event_guest' : 'employee');
  const [parentIdentifier, setParentIdentifier] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [humanToken, setHumanToken] = useState('');

  const needsParent = SUBORDINATE_TYPES.has(profileType);
  const usernameCheck = useLiveCheck('username', username, 3);
  const emailCheck = useLiveCheck('email', commEmail, 6);
  const mobileCheck = mobileHint(mobile);
  const [emailConfirmed, setEmailConfirmed] = useState(false);
  const [pwVerdict, setPwVerdict] = useState<PasswordVerdict>('blocked');
  const pwCtx = { username, email: commEmail, name: `${firstName} ${lastName}` };
  // Block only on what we know is wrong; the server has the final word on everything.
  // Submit only when nothing known is wrong: confirmed email, a valid mobile, an allowed password.
  const blocking = [usernameCheck, emailCheck, mobileCheck].some((v) => v && !v.ok) || !emailConfirmed || !(mobileCheck?.ok) || pwVerdict !== 'ok';

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setTaken(false);
    setLoading(true);
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          username,
          commEmail,
          mobile,
          backupEmail: backupEmail.trim() || undefined,
          password,
          purpose,
          profileType,
          parentIdentifier: needsParent && parentIdentifier.trim() ? parentIdentifier : undefined,
          ...(event ? { eventToken: event.token, source: event.source } : {}),
          humanToken,
          photoDataUrl,
        }),
      });
      const data = await response.json();
      // 409 = that username or email already has a profile: sign in rather than register again.
      if (response.status === 409) setTaken(true);
      if (!response.ok) throw new Error(data.error ?? 'Registration failed');
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <main className="mx-auto w-full max-w-sm space-y-4 px-4 py-12 text-center">
        <h1 className="text-lg font-semibold">Registration submitted</h1>
        <p className="text-sm text-gray-500">
          {event ? <>Your registration for <b>{event.name}</b> is waiting for approval. Once approved, you can sign in and show your entry pass at the gate during the event.</> : <>Your registration is pending approval. You&apos;ll be able to sign in once an
          authorized approver approves it.</>}
        </p>
        <Link href="/login" className="inline-flex min-h-10 items-center rounded bg-gray-900 px-4 text-sm font-medium text-white">
          Go to sign in
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-6 px-4 py-8">
      <div>
        {header ?? (
          <>
            <h1 className="text-lg font-semibold">EDC Registration</h1>
            <p className="text-sm text-gray-500">
              Register once — your profile stays even if access later expires.
            </p>
          </>
        )}
        <p className="mt-2 text-sm">
          Already registered?{' '}
          <Link href="/login" className="inline-flex min-h-10 items-center font-medium text-[#0D5B7A] underline md:min-h-0">Sign in instead</Link>
          <span className="block text-xs text-gray-500">Lost your pass or access ended? Don&apos;t register again — sign in to replace your QR code or request access from My account.</span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" value={firstName} onChange={setFirstName} required />
          <Field label="Last name" value={lastName} onChange={setLastName} required />
        </div>
        <Field
          label="Username"
          value={username}
          onChange={(v) => setUsername(v.toLowerCase())}
          required
          placeholder="letters, numbers, . _ -"
          autoComplete="username"
          hint={usernameCheck}
        />
        <EmailConfirm value={commEmail} onChange={setCommEmail} hint={emailCheck} humanToken={humanToken} onConfirmed={setEmailConfirmed} />
        <Field label="Mobile number" type="tel" value={mobile} onChange={setMobile} required autoComplete="tel" placeholder="98765 43210" hint={mobileCheck} />
        <Field label="Backup email (optional) — a second place for password resets and approval emails" type="email" value={backupEmail} onChange={setBackupEmail} autoComplete="off" />
        <PasswordField id="reg-password" label="Password" value={password} onChange={setPassword} ctx={pwCtx} onVerdict={setPwVerdict} />

        <div className="space-y-1">
          <label htmlFor="reg-purpose" className="text-sm font-medium">Profile / Purpose</label>
          <textarea
            id="reg-purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            required
            rows={2}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="reg-type" className="text-sm font-medium">Profile type</label>
          {event ? (
            // Event links register guests only; the server enforces it too.
            <>
              <input id="reg-type" value="Event Guest" readOnly aria-readonly="true"
                className="w-full rounded border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-700" />
              <p className="text-xs text-gray-500">Everyone registering for this event joins as an event guest.</p>
            </>
          ) : (
            <select
              id="reg-type"
              value={profileType}
              onChange={(e) => setProfileType(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {PROFILE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>

        {needsParent && (
          <Field
            label={event ? "Employee you're coming with (optional)" : "Controlling employee's username or access code"}
            value={parentIdentifier}
            onChange={setParentIdentifier}
            required={!event}
            placeholder="e.g. rahul or EDC25166"
          />
        )}

        <PhotoInput value={photoDataUrl} onChange={setPhotoDataUrl} />

        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
            {taken && <> <Link href="/login" className="font-medium underline">Sign in with it instead →</Link></>}
          </p>
        )}

        <HumanCheck onToken={setHumanToken} />

        <button
          type="submit"
          disabled={loading || blocking || (humanCheckOn && !humanToken)}
          className="w-full rounded bg-gray-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Submitting…' : 'Submit registration'}
        </button>
        {!loading && blocking && (
          <p className="text-center text-xs text-gray-500" aria-live="polite">
            {!emailConfirmed ? 'Confirm your email to submit.' : !(mobileCheck?.ok) ? 'Enter a valid mobile number.' : pwVerdict === 'checking' ? 'Checking your password…' : pwVerdict !== 'ok' ? 'Choose an allowed password.' : 'Fix the fields marked in red.'}
          </p>
        )}
      </form>
    </main>
  );
}
