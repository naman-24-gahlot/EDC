'use client';

import { useState } from 'react';
import Link from 'next/link';

// A plain GET form: "Apply" reloads the page with these filters; "Download" sends the same
// fields to the CSV export, so the file holds exactly the selection.
export function AuditFilterForm({ groups, selected, from, to, order, person }: {
  groups: readonly { label: string; actions: readonly string[] }[];
  selected: string[];
  from: string | null;
  to: string | null;
  order: 'desc' | 'asc';
  person: string | null;
}) {
  const all = groups.flatMap((g) => g.actions);
  const [ticked, setTicked] = useState<Set<string>>(new Set(selected.length ? selected : all));
  const set = (actions: readonly string[], on: boolean) => setTicked((prev) => {
    const next = new Set(prev);
    for (const a of actions) if (on) next.add(a); else next.delete(a);
    return next;
  });
  const summary = ticked.size === all.length ? 'All actions' : ticked.size === 0 ? 'No actions ticked' : `${ticked.size} of ${all.length} actions`;
  const field = 'rounded border border-gray-300 px-2 py-1.5 text-sm';

  return (
    <form action="/admin/audit" method="get" className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-3" aria-label="Filter the audit log">
      {person && <input type="hidden" name="person" value={person} />}
      <div className="flex flex-wrap items-end gap-3">
        <details className="relative">
          <summary className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded border border-gray-300 bg-white px-3 text-sm md:min-h-9">
            {summary} <span aria-hidden className="text-gray-400">▾</span>
          </summary>
          <div className="absolute z-20 mt-1 max-h-[70vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
            <div className="mb-2 flex gap-3 text-xs">
              <button type="button" className="underline" onClick={() => set(all, true)}>Tick all</button>
              <button type="button" className="underline" onClick={() => set(all, false)}>Clear</button>
            </div>
            {groups.map((g) => {
              const on = g.actions.filter((a) => ticked.has(a)).length;
              return (
                <fieldset key={g.label} className="mb-3">
                  <legend className="mb-1 flex w-full items-center gap-2 text-xs font-semibold uppercase text-gray-500">
                    <input type="checkbox" aria-label={`All ${g.label}`} checked={on === g.actions.length}
                      ref={(el) => { if (el) el.indeterminate = on > 0 && on < g.actions.length; }}
                      onChange={(e) => set(g.actions, e.target.checked)} />
                    {g.label} <span className="font-normal normal-case text-gray-400">{on}/{g.actions.length}</span>
                  </legend>
                  {g.actions.map((a) => (
                    <label key={a} className="flex min-h-8 items-center gap-2 pl-5 text-xs">
                      <input type="checkbox" name="action" value={a} checked={ticked.has(a)} onChange={(e) => set([a], e.target.checked)} />
                      {a.replace(/_/g, ' ').toLowerCase()}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        </details>
        <label className="space-y-1 text-xs font-semibold uppercase text-gray-500">
          <span className="block">From</span>
          <input type="date" name="from" defaultValue={from ?? ''} className={field} />
        </label>
        <label className="space-y-1 text-xs font-semibold uppercase text-gray-500">
          <span className="block">To</span>
          <input type="date" name="to" defaultValue={to ?? ''} className={field} />
        </label>
        <label className="space-y-1 text-xs font-semibold uppercase text-gray-500">
          <span className="block">Order</span>
          <select name="order" defaultValue={order} className={field}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={ticked.size === 0} className="min-h-10 rounded bg-gray-900 px-4 text-sm font-medium text-white disabled:opacity-50 md:min-h-9">Apply</button>
        <button type="submit" formAction="/api/admin/export/audit" disabled={ticked.size === 0} className="min-h-10 rounded border border-gray-400 bg-white px-4 text-sm font-medium disabled:opacity-50 md:min-h-9">
          Download these as CSV
        </button>
        <Link href={person ? `/admin/audit?person=${person}` : '/admin/audit'} className="inline-flex min-h-10 items-center text-sm text-gray-500 underline md:min-h-9">Reset</Link>
      </div>
    </form>
  );
}
