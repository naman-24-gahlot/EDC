// SERVER-ONLY. Cloudflare Turnstile (free, mostly invisible "are you human?" check) for the public
// forms: registration and forgot-password. OFF until both keys are set in Vercel
// (NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY) — then the forms show it and the server
// requires it. Until then the per-IP rate limits (proxy.ts) are the protection.
if (typeof window !== 'undefined') {
  throw new Error('lib/turnstile.ts must never be imported into client code.');
}

export const turnstileOn = () => !!process.env.TURNSTILE_SECRET_KEY && !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** True if Turnstile is off, or the token is genuine. Fails closed when it's on. */
export async function humanCheckPassed(token: unknown, ip: string): Promise<boolean> {
  if (!turnstileOn()) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token, remoteip: ip }),
    });
    return (await res.json().catch(() => null))?.success === true;
  } catch {
    return false;
  }
}
