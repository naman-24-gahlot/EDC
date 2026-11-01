'use client';

import { useEffect } from 'react';

// One listener for the whole app: under a real mouse, tells the .spotlight element being hovered
// where the pointer is (--x/--y), and its ::before glow follows (app/globals.css). Writes the
// style directly — no React state, no per-card components.
export function SpotlightTracker() {
  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const move = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.('.spotlight') as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--x', `${e.clientX - r.left}px`);
      card.style.setProperty('--y', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => document.removeEventListener('pointermove', move);
  }, []);
  return null;
}
