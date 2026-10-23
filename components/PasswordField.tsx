'use client';

import { useEffect, useState } from 'react';
import { breachCount, passwordStrength, type StrengthContext } from '@/lib/passwordStrength';

const BAR = ['bg-red-500', 'bg-orange-500', 'bg-amber-400', 'bg-lime-500', 'bg-emerald-600'];

// A new-password input with live feedback: strength meter, the first rule it breaks, and a
// warning if it appears in a known data breach (Have I Been Pwned — only 5 characters of a hash
// leave the browser). The server enforces the same rules on submit.
export function PasswordField({ id, label, value, onChange, ctx, required = true }: {
  id: string; label: string; value: string; onChange: (v: string) => void; ctx?: StrengthContext; required?: boolean;
}) {
  const s = passwordStrength(value, ctx);
  const [breach, setBreach] = useState<{ pw: string; count: number | null } | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (value.length < 8 || s.problem) return;
    const t = setTimeout(() => { breachCount(value).then((count) => setBreach({ pw: value, count })); }, 600);
    return () => clearTimeout(t);
  }, [value, s.problem]);
  const seen = breach?.pw === value ? breach.count : null;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      <div className="flex gap-2">
        <input id={id} type={shown ? 'text' : 'password'} autoComplete="new-password" required={required} minLength={8} maxLength={128}
          value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`}
          className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" onClick={() => setShown(!shown)} aria-pressed={shown} className="shrink-0 rounded border border-gray-300 px-2 text-xs text-gray-600">
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
      {value && (
        <div id={`${id}-hint`} className="space-y-1" aria-live="polite">
          <div className="flex items-center gap-2">
            <div className="flex h-1.5 flex-1 gap-1" aria-hidden>
              {[0, 1, 2, 3].map((i) => <span key={i} className={`flex-1 rounded-full ${i < Math.max(1, s.score) ? BAR[s.score] : 'bg-gray-200'}`} />)}
            </div>
            <span className="text-xs font-medium text-gray-600">{s.label}</span>
          </div>
          {s.problem ? <p className="text-xs text-red-700">{s.problem}</p>
            : seen && seen > 0 ? <p className="text-xs text-red-700">Found in {seen.toLocaleString('en-IN')} data breaches — attackers try these first. Pick another.</p>
            : s.tips[0] ? <p className="text-xs text-gray-500">{s.tips[0]}</p> : null}
        </div>
      )}
    </div>
  );
}
