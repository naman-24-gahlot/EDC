import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { isEmailConfirmed, requestEmailCheck } from '@/lib/emailCheck';
import { humanCheckPassed } from '@/lib/turnstile';
import { clientIpFrom } from '@/lib/rateLimit';
import { siteOrigin } from '@/lib/origin';

// Public, rate limited per IP (proxy.ts).
// POST { email, humanToken? } → sends the "confirm your email" link (before registering).
// GET ?email=… → { confirmed } — the form asks every few seconds while the link is opened elsewhere.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!(await humanCheckPassed(body?.humanToken, clientIpFrom(request.headers)))) {
    return NextResponse.json({ error: 'Please complete the “I’m human” check first.' }, { status: 400 });
  }
  try {
    await requestEmailCheck(body?.email, await siteOrigin());
    return NextResponse.json({ sent: true });
  } catch (err) {
    return errorResponse(err, 'Could not send the email.');
  }
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email') ?? '';
  if (!email || email.length > 254) return NextResponse.json({ confirmed: false });
  return NextResponse.json({ confirmed: await isEmailConfirmed(email) }, { headers: { 'Cache-Control': 'no-store' } });
}
