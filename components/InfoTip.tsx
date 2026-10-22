'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * A small "i" next to a control that explains what it does — the "toggletip" pattern
 * (Inclusive Components; WAI-ARIA APG tooltip notes): a real button, so it works by tap and
 * keyboard as well as hover; the text is in a live region so screen readers announce it;
 * Esc or a click elsewhere closes it. Hover-only tooltips fail on phones, hence the button.
 */
export function InfoTip({ label, children, align = 'right' }: { label: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false); // opened by a click/tap: stays until dismissed
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) { setOpen(false); setPinned(false); }
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('pointerdown', close); };
  }, [open]);

  return (
    <span ref={wrap} className="relative inline-flex align-middle"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setOpen(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse' && !pinned) setOpen(false); }}>
      <button type="button" aria-label={`What does “${label}” do?`} aria-expanded={open} aria-controls={id}
        onClick={() => { setPinned(!pinned || !open); setOpen(!pinned || !open); }}
        onFocus={() => setOpen(true)} onBlur={() => { if (!pinned) setOpen(false); }}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-gray-400 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-700 md:h-6 md:w-6">
        <span aria-hidden className="flex h-[18px] w-[18px] items-center justify-center rounded-full border border-current font-serif text-[11px] font-bold italic leading-none">i</span>
      </button>
      <span id={id} role="status" className="contents">
        {open && (
          <span className={`absolute top-full z-30 mt-1 w-max max-w-[min(18rem,80vw)] rounded-md bg-gray-900 px-3 py-2 text-left text-xs font-normal normal-case leading-snug tracking-normal text-white shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
            {children}
          </span>
        )}
      </span>
    </span>
  );
}
