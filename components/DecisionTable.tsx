'use client';

import { useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { sendJson } from '@/lib/clientFetch';

export interface DecisionRow {
  id: string;
  /** Short name used in result messages, e.g. the person's name. */
  label: string;
  /** Only undecided items can be ticked. */
  selectable: boolean;
  cells: ReactNode[];
}

interface Result { id: string; ok: boolean; error?: string }

// A table of things waiting for a decision, with tick boxes and one bar to approve or reject
// everything ticked (lib/decisions.ts runs each item through the same rules as a single click).
// Used for access requests, registrations and event registrations.
export function DecisionTable({ kind, headers, labels, rows, approveTypes, empty }: {
  kind: 'registration' | 'request';
  headers: string[];
  /** Card-view label for each column on phones (defaults to the header). */
  labels?: string[];
  rows: DecisionRow[];
  /** Registrations: optional "approve all ticked as …" choices. */
  approveTypes?: { type: string; label: string }[];
  empty: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [asType, setAsType] = useState('');
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string; failures: string[] } | null>(null);
  const selectable = rows.filter((r) => r.selectable).map((r) => r.id);
  const live = [...picked].filter((id) => selectable.includes(id)); // ticks on rows that just got decided drop out
  const allOn = selectable.length > 0 && live.length === selectable.length;
  const labelOf = new Map(rows.map((r) => [r.id, r.label]));
  const noun = kind === 'registration' ? 'registration' : 'request';

  function toggle(id: string, on: boolean) {
    setPicked((prev) => { const next = new Set(prev); if (on) next.add(id); else next.delete(id); return next; });
  }

  async function decide(action: 'approve' | 'reject') {
    setBusy(action);
    setOutcome(null);
    try {
      const data = await sendJson<{ results: Result[]; done: number; failed: number }>('/api/decisions', {
        kind, action, ids: live, ...(action === 'reject' && note.trim() ? { note } : {}), ...(action === 'approve' && asType ? { profileType: asType } : {}),
      });
      const verb = action === 'approve' ? 'Approved' : 'Rejected';
      const failures = data.results.filter((r) => !r.ok).map((r) => `${labelOf.get(r.id) ?? r.id}: ${r.error}`);
      setOutcome({
        ok: data.failed === 0,
        text: data.done ? `${verb} ${data.done} ${noun}${data.done === 1 ? '' : 's'}.${data.failed ? ` ${data.failed} could not be ${action}d:` : ''}` : `None could be ${action}d:`,
        failures,
      });
      setPicked(new Set(data.results.filter((r) => !r.ok).map((r) => r.id))); // keep only the ones that failed ticked
      setRejecting(false);
      setNote('');
      router.refresh();
    } catch (err) {
      setOutcome({ ok: false, text: err instanceof Error ? err.message : 'Could not process these.', failures: [] });
    } finally {
      setBusy(null);
    }
  }

  const btn = 'inline-flex min-h-10 items-center rounded px-3 text-sm font-semibold disabled:opacity-50 md:min-h-8';

  return (
    <div className="space-y-2" data-testid={`decision-table-${kind}`}>
      {outcome && (
        <div role="status" className={`rounded p-3 text-sm ${outcome.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
          {outcome.text}
          {outcome.failures.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs">{outcome.failures.map((f) => <li key={f}>{f}</li>)}</ul>}
        </div>
      )}

      {live.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 bg-white p-2 shadow-sm" role="region" aria-label="Selected items">
          <span className="px-1 text-sm font-semibold">{live.length} selected</span>
          {rejecting ? (
            <>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional, sent with every rejection)" aria-label="Reason for rejecting"
                className="min-w-0 flex-1 basis-48 rounded border border-gray-300 px-2 py-1.5 text-sm" />
              <button className={`${btn} bg-red-600 text-white`} disabled={!!busy} onClick={() => decide('reject')}>{busy === 'reject' ? 'Rejecting…' : `Reject ${live.length}`}</button>
              <button className={`${btn} border border-gray-300`} disabled={!!busy} onClick={() => setRejecting(false)}>Cancel</button>
            </>
          ) : (
            <>
              {approveTypes && (
                <select value={asType} onChange={(e) => setAsType(e.target.value)} aria-label="Approve as" className="min-h-10 rounded border border-gray-300 px-2 text-sm md:min-h-8">
                  <option value="">as each applied</option>
                  {approveTypes.map((t) => <option key={t.type} value={t.type}>as {t.label}</option>)}
                </select>
              )}
              <button className={`${btn} bg-emerald-700 text-white`} disabled={!!busy} onClick={() => decide('approve')}>{busy === 'approve' ? 'Approving…' : `Approve ${live.length}`}</button>
              <button className={`${btn} border border-gray-300`} disabled={!!busy} onClick={() => setRejecting(true)}>Reject…</button>
              <button className="text-xs text-gray-500 underline" disabled={!!busy} onClick={() => setPicked(new Set())}>Clear</button>
            </>
          )}
        </div>
      )}

      {selectable.length > 0 && (
        // Above the table, not in its header: on phones the table becomes cards and the header is hidden.
        <label className="inline-flex min-h-10 items-center gap-2 text-sm md:min-h-8">
          <input type="checkbox" checked={allOn} onChange={(e) => setPicked(e.target.checked ? new Set(selectable) : new Set())} />
          Select all {selectable.length} waiting{selectable.length < rows.length ? ' on this page' : ''}
        </label>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="rtable w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="w-8 px-3 py-2"><span className="sr-only">Select</span></th>
                {headers.map((h, i) => <th key={i} className="px-3 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((r) => (
                <tr key={r.id} data-row={r.id} className={picked.has(r.id) && r.selectable ? 'bg-emerald-50/50' : undefined}>
                  <td data-label="" className="px-3 py-2">
                    {r.selectable && (
                      <label className="inline-flex min-h-10 items-center gap-2 md:min-h-0">
                        <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} aria-label={`Select ${r.label}`} />
                        <span className="text-xs text-gray-500 md:hidden">Select</span>
                      </label>
                    )}
                  </td>
                  {r.cells.map((c, i) => <td key={i} data-label={(labels ?? headers)[i] ?? ''} className="px-3 py-2 align-top">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectable.length > 1 && live.length === 0 && <p className="text-xs text-gray-500">Tick several to approve or reject them together.</p>}
    </div>
  );
}
