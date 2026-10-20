import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, createSessionCookie, SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { changeOwnPassword } from '@/lib/people/profile';
import { RULES, clientIpFrom, loginLimiter } from '@/lib/rateLimit';

// Body: { currentPassword, newPassword }. Signs out every other device; keeps this one.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // Same budget as sign-in: this endpoint checks a password, so it mustn't become a guessing oracle.
  const attempt = loginLimiter.hit(RULES.loginPerAccount, `${clientIpFrom(request.headers)}|pw:${user.personId}`);
  if (!attempt.ok) {
    return NextResponse.json({ error: `Too many attempts — try again in ${Math.ceil(attempt.retryAfterSec / 60)} minute(s).` }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => null);
    const idToken = await changeOwnPassword(user, body?.currentPassword, body?.newPassword);
    const cookie = await createSessionCookie(idToken, user.systemRole);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE_NAME, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_EXPIRES_IN_MS[user.systemRole] / 1000,
      path: '/',
    });
    return res;
  } catch (err) {
    return errorResponse(err, 'Could not change your password.');
  }
}
