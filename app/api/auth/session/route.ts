import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { createSessionCookie, SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from '@/lib/session';
import { isRole } from '@/lib/roles';

// Exchanges a freshly-issued Firebase ID token (from client-side sign-in) for an
// httpOnly session cookie. The ID token itself is never stored — only this cookie.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const idToken = body?.idToken;

  if (!idToken || typeof idToken !== 'string') {
    return NextResponse.json({ error: 'Missing idToken' }, { status: 400 });
  }

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  if (!isRole(decoded.role)) {
    return NextResponse.json(
      { error: 'This account has no role assigned. Contact an EDC admin.' },
      { status: 403 }
    );
  }

  let sessionCookie: string;
  try {
    sessionCookie = await createSessionCookie(idToken);
  } catch {
    return NextResponse.json({ error: 'Could not create session' }, { status: 401 });
  }

  const response = NextResponse.json({ role: decoded.role });
  response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_EXPIRES_IN_MS / 1000,
    path: '/',
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
