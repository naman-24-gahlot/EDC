import { NextRequest, NextResponse } from 'next/server';
import { getPasswordResetSession, getSessionUser, createSessionCookie, SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { completePasswordReset } from '@/lib/people/profile';
import { RULES, clientIpFrom, loginLimiter } from '@/lib/rateLimit';

// After a Master reset: the one-time-password session picks the real password. Body: { newPassword }.
export async function POST(request: NextRequest) {
  const user = await getPasswordResetSession();
  if (!user) {
    // Already done (a lost reply on the first try) or the session ended mid-way.
    if (await getSessionUser()) return NextResponse.json({ error: 'Your password is already set.', done: true }, { status: 409 });
    return NextResponse.json({ error: 'Your session ended. Sign in again — with your new password if you already chose one, otherwise with the one-time password.' }, { status: 401 });
  }
  const attempt = loginLimiter.hit(RULES.loginPerAccount, `${clientIpFrom(request.headers)}|setpw:${user.personId}`);
  if (!attempt.ok) return NextResponse.json({ error: `Too many attempts — try again in ${Math.ceil(attempt.retryAfterSec / 60)} minute(s).` }, { status: 429 });

  try {
    const body = await request.json().catch(() => null);
    const idToken = await completePasswordReset(user.personId, body?.newPassword);
    const res = NextResponse.json({ ok: true, systemRole: user.systemRole });
    res.cookies.set(SESSION_COOKIE_NAME, await createSessionCookie(idToken, user.systemRole), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_EXPIRES_IN_MS[user.systemRole] / 1000,
      path: '/',
    });
    return res;
  } catch (err) {
    return errorResponse(err, 'Could not set your password.');
  }
}
