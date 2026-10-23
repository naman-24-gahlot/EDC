'use client';

import { useEffect, useRef } from 'react';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void };

// Cloudflare Turnstile widget. Renders nothing (and loads nothing) until the site key is set —
// see lib/turnstile.ts. Calls onToken with the token, or '' when it expires.
export function HumanCheck({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!SITE_KEY || !box.current) return;
    let id: string | null = null;
    const draw = () => {
      const t = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (t && box.current) id = t.render(box.current, { sitekey: SITE_KEY, callback: onToken, 'expired-callback': () => onToken(''), 'error-callback': () => onToken('') });
    };
    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) draw();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = draw;
      document.head.appendChild(s);
    }
    return () => { if (id) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(id); };
  }, [onToken]);
  return SITE_KEY ? <div ref={box} className="min-h-[65px]" /> : null;
}

export const humanCheckOn = !!SITE_KEY;
