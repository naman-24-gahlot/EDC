import { NextRequest, NextResponse } from 'next/server';
import { checkEmail, checkUsername } from '@/lib/registrationChecks';

// Public, read-only. ?username=… and/or ?email=… → { username?, email? } verdicts for the form's
// live hints. Rate limited per IP (proxy.ts); submitting re-checks everything regardless.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const username = q.get('username');
  const email = q.get('email');
  const out: Record<string, unknown> = {};
  if (username !== null && username.length <= 60) out.username = await checkUsername(username);
  if (email !== null && email.length <= 254) out.email = await checkEmail(email);
  return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
}
