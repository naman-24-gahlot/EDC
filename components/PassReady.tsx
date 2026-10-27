'use client';

import { useEffect } from 'react';
import { NextPerson, type KioskNext } from '@/components/NextPerson';

export interface IssuedPass {
  passToken: string; accessCode: string | null; print: 'off' | 'button' | 'auto'; cardSize: string; emailed: boolean;
  kiosk: boolean; kioskNext?: KioskNext; kioskSeconds?: number;
}

/** The print page for this pass; on a kiosk it carries where to go next and how (lib/events.ts). */
export function printHref(pass: IssuedPass, nextHref: string) {
  const p = new URLSearchParams({ t: pass.passToken, size: pass.cardSize });
  if (pass.kiosk) { p.set('next', nextHref); p.set('nm', pass.kioskNext ?? 'auto'); p.set('ns', String(pass.kioskSeconds ?? 20)); }
  return `/print/pass?${p}`;
}

// After a registration approved on the spot (event setting): the pass is ready. Depending on the
// event: print it automatically, offer a Print button, or just show it. On a kiosk, "Next person"
// works as the event says (NextPerson) and never lets Back bring this pass up again.
export function PassReady({ pass, name, nextHref }: { pass: IssuedPass; name: string; nextHref: string }) {
  const href = printHref(pass, nextHref);

  useEffect(() => {
    if (pass.print === 'auto') window.location.replace(`${href}&auto=1`);
  }, [pass.print, href]);

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
        {pass.print === 'button' && <a href={href} className={`${btn} bg-gray-900 text-white`} data-testid="print-my-pass">Print my pass</a>}
        {!pass.kiosk && <a href={`/v/${encodeURIComponent(pass.passToken)}`} className={`${btn} border border-gray-300 bg-white`}>Open my pass</a>}
        {pass.kiosk && <NextPerson href={nextHref} mode={pass.kioskNext ?? 'auto'} seconds={pass.kioskSeconds ?? 20} />}
      </div>
      {pass.kiosk
        ? <p className="text-xs text-gray-600">Your pass is {pass.emailed ? 'in your email, and ' : ''}{pass.print === 'button' ? 'printable above' : 'saved with us'} — show it, or tell the guard your access code, at the gate.</p>
        : <p className="text-xs text-gray-600">Keep the “Open my pass” link (bookmark it, or screenshot the QR): it works as your pass at the gate.</p>}
    </div>
  );
}
