'use client';

import { useEffect, useRef } from 'react';

// Text that decodes itself once on arrival: letters cycle through ASCII glyphs and lock in left to
// right (~650 ms) — the same language as the ASCII logo. Screen readers get the plain text at
// once (a hidden copy); reduced motion shows it plain. Writes to the DOM directly, no re-renders.
const GLYPHS = '!<>-_\\/[]{}=+*^?#%@$&';

export function DecodeText({ text, delay = 0, className = '' }: { text: string; delay?: number; className?: string }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = el.current;
    if (!node || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now() + delay;
    const duration = 650;
    const tick = (now: number) => {
      const t = Math.max(0, now - start);
      const locked = Math.floor((t / duration) * text.length);
      node.textContent = text.split('').map((ch, i) => (i < locked || ch === ' ' ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
      if (locked < text.length) frame = requestAnimationFrame(tick);
      else node.textContent = text;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); node.textContent = text; };
  }, [text, delay]);
  // The invisible copy fixes the width, so the glyphs never push the layout around.
  return (
    <span className={`relative inline-block ${className}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="invisible">{text}</span>
      <span ref={el} aria-hidden className="absolute inset-0 overflow-hidden whitespace-nowrap">{text}</span>
    </span>
  );
}
