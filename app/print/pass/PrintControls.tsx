'use client';

import { useEffect, useState } from 'react';

// Print button, and for kiosks (?auto=1) printing by itself once the page has loaded, then
// offering (or after a short wait, going to) the next registration.
export function PrintControls({ auto, next, pdfHref }: { auto: boolean; next: string | null; pdfHref: string }) {
  const [printed, setPrinted] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const done = () => setPrinted(true);
    window.addEventListener('afterprint', done);
    // Fonts and the photo first, so the printout is complete.
    const t = auto ? window.setTimeout(() => { void document.fonts?.ready.then(() => window.print()); }, 600) : undefined;
    return () => { window.removeEventListener('afterprint', done); if (t) window.clearTimeout(t); };
  }, [auto]);

  useEffect(() => {
    if (!printed || !next || !auto) return;
    setLeft(15); // eslint-disable-line react-hooks/set-state-in-effect -- countdown starts after printing
    const id = window.setInterval(() => setLeft((s) => {
      if (s === null) return s;
      if (s <= 1) { window.location.replace(next); return 0; } // replace: Back can't bring this pass up again
      return s - 1;
    }), 1000);
    return () => window.clearInterval(id);
  }, [printed, next, auto]);

  const btn = 'inline-flex min-h-11 items-center justify-center rounded px-4 text-sm font-semibold';
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" onClick={() => window.print()} className={`${btn} bg-gray-900 text-white`}>{printed ? 'Print again' : 'Print'}</button>
      <a href={pdfHref} className={`${btn} border border-gray-300 bg-white`}>Download PDF</a>
      {next && <button type="button" onClick={() => window.location.replace(next)} className={`${btn} border border-emerald-600 bg-emerald-50 text-emerald-900`} data-testid="next-person">Next person{left !== null ? ` (${left})` : ''}</button>}
    </div>
  );
}
