'use client';

import { useState } from 'react';
import type { OnCampus } from '@/lib/gate';

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

// "On campus now": everyone whose last gate scan was an entry, as a headcount per group (for a
// roll call or evacuation), with who has stayed overnight or past their hours. Download/print
// work from what's on screen — nothing extra is fetched.
export function OnCampusPanel({ people }: { people: OnCampus[] }) {
  const [group, setGroup] = useState<string | null>(null);
  const groups = [...people.reduce((m, p) => m.set(p.group, (m.get(p.group) ?? 0) + 1), new Map<string, number>())];
  const shown = group ? people.filter((p) => p.group === group) : people;
  const warnings = people.filter((p) => p.overnight || p.afterHours).length;

  function download() {
    // Quote, and defuse cells a spreadsheet would run as a formula (= + - @ at the start).
    const esc = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
    const lines = [['Name', 'Group', 'VVIP', 'In since (IST)', 'Note'].join(','),
      ...shown.map((p) => [esc(p.name), esc(p.group), p.vvip ? 'yes' : '', esc(when(p.since)), esc(note(p))].join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    a.download = `on-campus-${new Date().toISOString().slice(0, 16).replace(':', '')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <details className="rounded-lg border border-gray-200 bg-white p-3 print:border-0" open={people.length > 0 && people.length <= 12}>
      <summary className="flex min-h-10 cursor-pointer flex-wrap items-center justify-between gap-2 text-sm md:min-h-0">
        <span><b className="text-lg" data-testid="on-campus-count">{people.length}</b> on campus now
          {warnings > 0 && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900" data-testid="stay-warnings">{warnings} overnight / after hours</span>}</span>
        <span className="text-xs text-gray-500">last scan was an entry</span>
      </summary>
      {people.length === 0 ? <p className="mt-2 text-sm text-gray-400">Nobody right now.</p> : (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-1.5 print:hidden" role="group" aria-label="Headcount by group">
            <button type="button" onClick={() => setGroup(null)} aria-pressed={group === null}
              className={`min-h-9 rounded-full px-3 text-xs font-semibold ${group === null ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>All {people.length}</button>
            {groups.map(([g, n]) => (
              <button type="button" key={g} onClick={() => setGroup(g === group ? null : g)} aria-pressed={group === g}
                className={`min-h-9 rounded-full px-3 text-xs font-semibold ${group === g ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>{g} {n}</button>
            ))}
          </div>
          <ul className="divide-y divide-gray-100 text-sm">
            {shown.map((p) => (
              <li key={p.personId} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{p.name}{p.vvip && <b className="ml-1 rounded bg-purple-100 px-1 text-[11px] text-purple-900">VVIP</b>} <span className="text-xs text-gray-500">{p.group}</span>
                  {(p.overnight || p.afterHours) && <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">{note(p)}</span>}</span>
                <span className="text-xs text-gray-500">in since {when(p.since)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 print:hidden">
            <button type="button" onClick={download} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-xs font-medium md:min-h-8">Download list (CSV)</button>
            <button type="button" onClick={() => window.print()} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-3 text-xs font-medium md:min-h-8">Print</button>
          </div>
        </div>
      )}
    </details>
  );
}

const note = (p: OnCampus) => (p.overnight ? 'inside since an earlier day' : p.afterHours ? 'still inside after hours' : p.allowedOvernight ? 'overnight allowed' : '');
