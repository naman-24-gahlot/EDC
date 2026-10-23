import { NextRequest, NextResponse, after } from 'next/server';
import { requestPasswordReset } from '@/lib/people/profile';
import { siteOrigin } from '@/lib/origin';
import { humanCheckPassed } from '@/lib/turnstile';
import { clientIpFrom } from '@/lib/rateLimit';

const ANSWER = { ok: true, message: 'If that account exists and is active, a reset link is on its way to the email address it was registered with. The link works once, for about an hour.' };

// Public. Body: { identifier } (username / EDC email / email). Always the same answer, sent
// before any lookup happens — the work runs after the response, so neither the words nor the
// timing reveal whether an account exists. Rate limited per IP in proxy.ts.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  // Not about the account, so it can't reveal one: only whether the human check passed.
  if (!(await humanCheckPassed(body?.humanToken, clientIpFrom(request.headers)))) {
    return NextResponse.json({ error: 'Please complete the “I’m human” check and try again.' }, { status: 400 });
  }
  const origin = await siteOrigin();
  after(() => requestPasswordReset(body?.identifier, origin).catch((err) => console.error('Password reset email failed', err)));
  return NextResponse.json(ANSWER);
}
