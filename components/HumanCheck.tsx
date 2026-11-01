'use client';

import { useEffect, useRef, useState } from 'react';
import { useTestMode } from '@/components/useTestMode';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id: string) => void; remove: (id: string) => void };
const api = () => (window as unknown as { turnstile?: TurnstileApi }).turnstile;

// Cloudflare Turnstile widget. Renders nothing (and loads nothing) until the site key is set —
// see lib/turnstile.ts — or while testing mode is on (lib/testMode.ts): then it hands the form a
// stand-in token, which the server doesn't check in testing mode. Calls onToken with the token,
// or '' when it expires or fails.
// A token works ONCE (Cloudflare refuses it the second time): after sending it, the form calls
// useHumanCheck's `used()`, which clears it and draws a fresh widget for the next try.
// If Cloudflare refuses the visitor, the error code is shown with a "Try again" button — the codes
// are listed at developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes.
export function HumanCheck({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const testing = useTestMode(!!SITE_KEY);
  useEffect(() => { if (testing) onToken('testing-mode'); }, [testing, onToken]);
  useEffect(() => {
    if (!SITE_KEY || testing !== false || !box.current) return;
    const draw = () => {
      const t = api();
      if (t && box.current) widget.current = t.render(box.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => { setFailed(null); onToken(token); },
        'expired-callback': () => onToken(''),
        'error-callback': (code: unknown) => { onToken(''); setFailed(String(code ?? '')); return true; },
        'unsupported-callback': () => setFailed('unsupported browser'),
      });
    };
    if (api()) draw();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = draw;
      s.onerror = () => setFailed('could not load — challenges.cloudflare.com is blocked on this network or by an extension');
      document.head.appendChild(s);
    }
    return () => { if (widget.current) api()?.remove(widget.current); widget.current = null; };
  }, [onToken, testing]);
  if (!SITE_KEY || testing !== false) return null;
  return (
    <div className="space-y-1">
      <div ref={box} className="min-h-[65px]" />
      {failed !== null && (
        <p className="text-xs text-red-700" role="alert" data-testid="human-check-error">
          The “I’m human” check didn’t pass{failed ? ` (Cloudflare: ${failed})` : ''}. Try again; if it keeps failing, turn off ad blockers or VPN, or use another browser or your phone.{' '}
          <button type="button" className="font-medium underline" onClick={() => { setFailed(null); if (widget.current) api()?.reset(widget.current); }}>Try again</button>
        </p>
      )}
    </div>
  );
}

/** Token state for a form with <HumanCheck>. Render it as `<HumanCheck key={round} onToken={setToken} />`
 *  and call `used()` after every request that sent the token (success or not). */
export function useHumanCheck() {
  const [token, setToken] = useState('');
  const [round, setRound] = useState(0);
  const used = () => { setToken(''); setRound((n) => n + 1); };
  return { token, setToken, round, used };
}

export const humanCheckOn = !!SITE_KEY;
