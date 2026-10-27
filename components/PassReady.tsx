'use client';

import { useEffect, useState } from 'react';

export interface IssuedPass { passToken: string; accessCode: string | null; print: 'off' | 'button' | 'auto'; cardSize: string; kiosk: boolean; emailed: boolean }

// After a registration approved on the spot (event setting): the pass is ready. Depending on the
// event: print it automatically, offer a Print button, or just show it. On a kiosk the screen
// clears itself for the next person — `replace`, so Back can't bring the previous person's pass up.
export function PassReady({ pass, name, nextHref }: { pass: IssuedPass; name: string; nextHref: string }) {
  const t = encodeURIComponent(pass.passToken);
  const printHref = `/print/pass?t=${t}&size=${pass.cardSize}${pass.kiosk ? `&next=${encodeURIComponent(nextHref)}` : ''}`;
  const [left, setLeft] = useState(pass.kiosk ? 45 : null);

  useEffect(() => {
    if (pass.print === 'auto') window.location.replace(`${printHref}&auto=1`);
  }, [pass.print, printHref]);

  useEffect(() => {
    if (left === null || pass.print === 'auto') return;
    if (left <= 0) { window.location.replace(nextHref); return; }
    const id = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left, nextHref, pass.print]);

  if (pass.print === 'auto') return <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm" role="status">Approved — printing your pass…</p>;
  const btn = 'inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-base font-semibold';
  return (
    <div className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50 p-5" role="status" data-testid="pass-ready">
      <div>
        <p className="text-lg font-bold text-emerald-900">You’re registered, {name} — your pass is ready.</p>
        {pass.accessCode && <p className="mt-1 text-sm">Access code: <b className="font-mono text-base tracking-wider">{pass.accessCode}</b> (tell it to the guard if the QR won’t scan)</p>}
        {pass.emailed && <p className="mt-1 text-sm text-emerald-900">We’ve also emailed it to you.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {pass.print === 'button' && <a href={printHref} className={`${btn} bg-gray-900 text-white`} data-testid="print-my-pass">Print my pass</a>}
        <a href={`/v/${t}`} className={`${btn} border border-gray-300 bg-white`}>Open my pass</a>
        {pass.kiosk && <button type="button" onClick={() => window.location.replace(nextHref)} className={`${btn} border border-emerald-600 bg-white text-emerald-900`}>Next person{left !== null ? ` (${left})` : ''}</button>}
      </div>
      {!pass.kiosk && <p className="text-xs text-gray-600">Keep the “Open my pass” link (bookmark it, or screenshot the QR): it works as your pass at the gate.</p>}
    </div>
  );
}
