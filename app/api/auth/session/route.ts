import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { loginWithIdentifier, LoginError } from '@/lib/auth/login';
import { createSessionCookie, SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from '@/lib/session';
import { isSystemRole } from '@/lib/roles';
import { RULES, clientIpFrom, loginLimiter } from '@/lib/rateLimit';

// Deliberately identical for "unknown identifier" and "wrong password" — no
// enumeration oracle. See SECURITY_MODEL.md "Identity and login".
const GENERIC_ERROR = { error: 'Invalid username/email or password.' };

// Resolves identifier -> person -> verifies password server-side (lib/auth/login.ts)
// -> issues the httpOnly session cookie. The client never receives or holds an ID
// token or the canonical account email.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const identifier = typeof body?.identifier === 'string' ? body.identifier : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!identifier || !password || identifier.length > 254 || password.length > 256) {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  // Per account (per IP): stops password guessing against one person without locking out a
  // whole campus that shares one Wi-Fi address. Counted before any lookup, so it costs nothing.
  const attempt = loginLimiter.hit(RULES.loginPerAccount, `${clientIpFrom(request.headers)}|${identifier.trim().toLowerCase()}`);
  if (!attempt.ok) {
    return NextResponse.json(
      { error: `Too many sign-in attempts — try again in ${Math.ceil(attempt.retryAfterSec / 60)} minute(s).` },
      { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSec) } }
    );
  }

  let idToken: string;
  try {
    ({ idToken } = await loginWithIdentifier(identifier, password));
  } catch (err) {
    if (err instanceof LoginError) {
      return NextResponse.json(GENERIC_ERROR, { status: 401 });
    }
    console.error('Login failed unexpectedly', err);
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  if (!isSystemRole(decoded.systemRole)) {
    return NextResponse.json(GENERIC_ERROR, { status: 401 });
  }

  const sessionCookie = await createSessionCookie(idToken, decoded.systemRole);

  const response = NextResponse.json({ systemRole: decoded.systemRole });
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_EXPIRES_IN_MS[decoded.systemRole] / 1000,
    path: '/',
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
