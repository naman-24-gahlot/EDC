'use client';

import { useEffect, useState } from 'react';
import { NextPerson, type KioskNext } from '@/components/NextPerson';

// Print (and, outside kiosks, Download PDF). With ?auto=1 it prints by itself once the page has
// loaded. On a kiosk (`next`), "Next person" follows the event's setting; when printing
// automatically, its timer starts once printing has finished.
export function PrintControls({ auto, next, nextMode, nextSeconds, pdfHref }: { auto: boolean; next: string | null; nextMode: KioskNext; nextSeconds: number; pdfHref: string }) {
  const [printed, setPrinted] = useState(false);

  useEffect(() => {
    const done = () => setPrinted(true);
    window.addEventListener('afterprint', done);
    // Fonts and the photo first, so the printout is complete.
    const t = auto ? window.setTimeout(() => { void document.fonts?.ready.then(() => window.print()); }, 600) : undefined;
    return () => { window.removeEventListener('afterprint', done); if (t) window.clearTimeout(t); };
  }, [auto]);

  const btn = 'inline-flex min-h-12 items-center justify-center rounded-lg px-5 text-base font-semibold';
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" onClick={() => window.print()} className={`${btn} bg-gray-900 text-white`}>{printed ? 'Print again' : 'Print'}</button>
      {!next && <a href={pdfHref} className={`${btn} border border-gray-300 bg-white`}>Download PDF</a>}
      {next && <NextPerson href={next} mode={nextMode} seconds={nextSeconds} start={!auto || printed} />}
    </div>
  );
}
