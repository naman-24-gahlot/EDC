'use client';

import { useEffect, useState } from 'react';
import { breachCount, passwordStrength, type StrengthContext } from '@/lib/passwordStrength';

/** One verdict the form's submit button follows — the same rules the server enforces. */
export type PasswordVerdict = 'ok' | 'blocked' | 'checking';

const BAR = ['bg-red-500', 'bg-amber-400', 'bg-lime-500', 'bg-emerald-600'];

// A new-password input with live feedback. It is never more generous than the server: if the
// rules (length, common, your own name/username/email) or the leak check (Have I Been Pwned — only
// 5 characters of a hash leave the browser) would refuse it, it says "Not allowed" and the
// verdict is 'blocked'. While the leak check runs the verdict is 'checking'.
export function PasswordField({ id, label, value, onChange, ctx, onVerdict, required = true }: {
  id: string; label: string; value: string; onChange: (v: string) => void; ctx?: StrengthContext;
  onVerdict?: (v: PasswordVerdict) => void; required?: boolean;
}) {
  const s = passwordStrength(value, ctx);
  const [breach, setBreach] = useState<{ pw: string; count: number | null } | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (value.length < 8 || s.problem) return;
    let live = true;
    const t = setTimeout(() => { breachCount(value).then((count) => { if (live) setBreach({ pw: value, count }); }); }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [value, s.problem]);

  const checked = breach?.pw === value;
  const leaked = checked && (breach.count ?? 0) > 0;
  const problem = !value ? null : s.problem ?? (leaked ? `Found in ${breach!.count!.toLocaleString('en-IN')} data breaches — attackers try these first. Pick another.` : null);
  // A failed check (null) doesn't block: the server fails open the same way.
  const verdict: PasswordVerdict = !value || problem ? 'blocked' : checked ? 'ok' : 'checking';
  useEffect(() => { onVerdict?.(verdict); }, [verdict, onVerdict]);

  // Allowed passwords are never called weak; the bar shows how much stronger it could be.
  const allowedLabel = ['Okay', 'Okay', 'Fair', 'Good', 'Strong'][s.score];
  const filled = problem ? 1 : Math.max(1, s.score);

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={id} type={shown ? 'text' : 'password'} autoComplete="new-password" required={required} minLength={8} maxLength={128}
          value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`} aria-invalid={problem ? true : undefined}
          className={`min-w-0 flex-1 rounded border px-3 py-2 text-sm ${problem ? 'border-red-400' : 'border-gray-300'}`} />
        <button type="button" onClick={() => setShown(!shown)} aria-pressed={shown} className="shrink-0 rounded border border-gray-300 px-2 text-xs text-gray-600">
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {value ? (
        <div id={`${id}-hint`} className="space-y-1" aria-live="polite">
          <div className="flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => <span key={i} className={`flex-1 rounded-full ${i < filled ? (problem ? 'bg-red-500' : BAR[filled - 1]) : 'bg-gray-200'}`} />)}
            </div>
            <span className={`text-xs font-medium ${problem ? 'text-red-700' : 'text-gray-600'}`}>
              {problem ? 'Not allowed' : verdict === 'checking' ? 'Checking…' : allowedLabel}
            </span>
          </div>
          {problem ? <p className="text-xs text-red-700">{problem}</p>
            : verdict === 'checking' ? <p className="text-xs text-gray-500">Checking it against known leaked passwords…</p>
            : s.tips[0] ? <p className="text-xs text-gray-500">Allowed. {s.tips[0]}</p> : <p className="text-xs text-emerald-700">✓ Allowed</p>}
        </div>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-gray-500">At least 8 characters; not a common password, and not your name, username or email.</p>
      )}
    </div>
  );
}
