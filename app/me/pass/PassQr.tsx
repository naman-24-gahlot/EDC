'use client';

import { useEffect, useRef, useState } from 'react';

// The QR on the pass; tap it for a full-screen view that's easier for the gate camera to
// read, with the screen kept awake while it's open. The SVG is generated server-side.
export function PassQr({ svg, code, name }: { svg: string; code: string | null; name: string }) {
  const [open, setOpen] = useState(false);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request('screen').then((l) => { lock.current = l; }).catch(() => {});
    return () => {
      window.removeEventListener('keydown', onKey);
      lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-[300px] max-w-full rounded-[14px] border border-[#D5DDE4] bg-white p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0D5B7A] [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
        data-testid="pass-qr"
        aria-label="Entry pass QR code — tap to show full screen"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <p className="-mt-2 text-xs text-[#7C8C9B]">Tap the QR to show it full screen</p>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Entry pass QR, full screen"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white p-6 text-[#1B2A38]"
        >
          <div
            className="w-[min(88vw,calc(100vh-220px))] [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className="text-lg font-bold">{name}</p>
          {code && <p className="font-mono text-3xl font-semibold tracking-[.18em]">{code}</p>}
          <p className="text-sm text-[#7C8C9B]">Tap anywhere to close</p>
        </div>
      )}
    </>
  );
}
