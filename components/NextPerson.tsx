'use client';

import { useEffect, useState } from 'react';

export type KioskNext = 'auto' | 'unlock' | 'button';

// The kiosk's "Next person" button, as the event's Master chose (lib/events.ts kioskNext):
//  auto   — goes to the next registration by itself after `seconds` (or at once when tapped)
//  unlock — the button only becomes tappable after `seconds` (time to collect the printout)
//  button — just the button; never moves on by itself
// `start` delays the countdown (e.g. until printing has finished). Navigation uses replace(), so
// Back can't bring the previous person's pass up again.
export function NextPerson({ href, mode, seconds, start = true, className = '' }: { href: string; mode: KioskNext; seconds: number; start?: boolean; className?: string }) {
  const [left, setLeft] = useState(seconds);
  const go = () => window.location.replace(href);

  useEffect(() => {
    if (!start || mode === 'button') return;
    if (left <= 0) { if (mode === 'auto') go(); return; }
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [start, mode, left]); // eslint-disable-line react-hooks/exhaustive-deps -- `go` is stable enough: href never changes on a page

  const locked = mode === 'unlock' && left > 0;
  const label = mode === 'auto' && start ? `Next person (${left})` : locked ? (start ? `Next person in ${left}s` : 'Next person') : 'Next person';
  return (
    <button type="button" onClick={go} disabled={locked} data-testid="next-person"
      className={`inline-flex min-h-12 items-center justify-center rounded-lg border border-emerald-600 bg-white px-5 text-base font-semibold text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {label}
    </button>
  );
}
