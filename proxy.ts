import { createHash } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { RateLimiter, bucketsFor, clientIpFrom } from '@/lib/rateLimit';

// Runs before every page and API request. Three jobs, none of them authorization (that stays
// in each page and route):
//  1. CSRF defence in depth — refuse state-changing API calls from other sites. The session
//     cookie is already SameSite=Lax, but login itself needs no cookie, so a foreign page could
//     otherwise sign a browser into an attacker's account. Browsers always send Origin /
//     Sec-Fetch-Site on cross-origin POSTs; requests with neither aren't from a browser.
//  2. Rate limiting (lib/rateLimit.ts) — floods and mistakes get a 429 before any database work.
//  3. Body size cap on API calls, so a huge body is refused before it's parsed.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const MAX_API_BODY_BYTES = 1024 * 1024;
const limiter = new RateLimiter();

function sessionKey(request: NextRequest): string | null {
  const value = request.cookies.get('session')?.value;
  return value ? createHash('sha256').update(value).digest('base64url').slice(0, 22) : null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  if (isApi && !SAFE_METHODS.has(request.method)) {
    const fetchSite = request.headers.get('sec-fetch-site');
    if (fetchSite === 'cross-site' || fetchSite === 'same-site') return refuse(403, 'Cross-site request refused.');
    const origin = request.headers.get('origin');
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        return refuse(403, 'Cross-site request refused.');
      }
      if (originHost !== request.headers.get('host')) return refuse(403, 'Cross-site request refused.');
    }
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_API_BODY_BYTES) return refuse(413, 'Request too large.');
  }

  for (const { rule, key } of bucketsFor({ method: request.method, pathname, ip: clientIpFrom(request.headers), sessionKey: sessionKey(request) })) {
    const r = limiter.hit(rule, key);
    if (!r.ok) {
      const res = isApi
        ? refuse(429, `Too many requests — try again in ${r.retryAfterSec} seconds.`)
        : new NextResponse(`Too many requests — try again in ${r.retryAfterSec} seconds.`, { status: 429, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      res.headers.set('Retry-After', String(r.retryAfterSec));
      return res;
    }
  }
  return NextResponse.next();
}

function refuse(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

// Everything except static assets (which never touch the database).
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'] };
