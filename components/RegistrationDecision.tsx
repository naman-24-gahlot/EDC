'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export interface ApproveOption { type: string; label: string; access: string }

// Approve (as a chosen profile type) or reject a registration. The options and who may pick
// which come from the server (approvableTypes); the API re-checks everything.
export function RegistrationDecision({ personId, name, status, appliedAs, options }: {
  personId: string;
  name: string;
  status: string;
  appliedAs: string;
  options: ApproveOption[];
}) {
  const router = useRouter();
  const start = options.some((o) => o.type === appliedAs) ? appliedAs : options[0]?.type ?? appliedAs;
  const [type, setType] = useState(start);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const chosen = options.find((o) => o.type === type);
  const appliedLabel = options.find((o) => o.type === appliedAs)?.label ?? appliedAs;
  const id = `approve-as-${personId}`;

  async function act(action: 'approve' | 'reject', body: unknown) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/registrations/${personId}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Could not ${action}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action}`);
      setBusy(null);
    }
  }

  if (rejecting) {
    return (
      <div className="space-y-2">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" rows={2} aria-label={`Reason for rejecting ${name}`}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => act('reject', { note })} disabled={!!busy} className="min-h-10 rounded bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-50 md:min-h-8">
            {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
          </button>
          <button onClick={() => setRejecting(false)} disabled={!!busy} className="min-h-10 rounded border border-gray-300 px-3 text-sm md:min-h-8">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="registration-decision">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-xs font-semibold uppercase text-gray-500">Approve as</label>
        <select id={id} value={type} onChange={(e) => setType(e.target.value)} className="min-h-10 rounded border border-gray-300 px-2 text-sm md:min-h-8">
          {options.map((o) => <option key={o.type} value={o.type}>{o.label}{o.type === appliedAs ? ' (applied for)' : ''}</option>)}
        </select>
      </div>
      {chosen && (
        <p className={`text-xs ${type !== appliedAs ? 'rounded border border-amber-200 bg-amber-50 p-2 text-amber-900' : 'text-gray-500'}`}>
          {type !== appliedAs && <>They applied as <b>{appliedLabel}</b> and will be told about the change when they next open their account. </>}
          Access granted on approval: <b>{chosen.access}</b>
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => act('approve', { profileType: type })} disabled={!!busy} aria-label={`Approve ${name} as ${chosen?.label ?? type}`}
          className="min-h-10 rounded bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50 md:min-h-8">
          {busy === 'approve' ? 'Approving…' : status === 'REJECTED' ? `Approve anyway as ${chosen?.label ?? type}` : `Approve as ${chosen?.label ?? type}`}
        </button>
        {status === 'PENDING' && (
          <button onClick={() => setRejecting(true)} disabled={!!busy} className="min-h-10 rounded border border-gray-300 bg-white px-4 text-sm font-semibold disabled:opacity-50 md:min-h-8">Reject</button>
        )}
      </div>
    </div>
  );
}
