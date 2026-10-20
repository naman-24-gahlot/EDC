import { NextResponse, type NextRequest } from 'next/server';

// CSRF defence in depth for every state-changing API call. The session cookie is already
// SameSite=Lax (cross-site POSTs don't carry it), but login itself needs no cookie, so a
// foreign page could otherwise sign a victim's browser into an attacker's account.
// Browsers always send Origin (and Sec-Fetch-Site) on cross-origin POSTs; requests with
// neither aren't from a browser and so aren't CSRF. Authorization stays in the routes.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function proxy(request: NextRequest) {
  if (SAFE_METHODS.has(request.method)) return NextResponse.next();

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') return forbidden();

  const origin = request.headers.get('origin');
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      return forbidden();
    }
    if (originHost !== request.headers.get('host')) return forbidden();
  }
  return NextResponse.next();
}

function forbidden() {
  return NextResponse.json({ error: 'Cross-site request refused.' }, { status: 403 });
}

export const config = { matcher: '/api/:path*' };
