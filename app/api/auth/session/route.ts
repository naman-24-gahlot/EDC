import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { loginWithIdentifier, LoginError } from '@/lib/auth/login';
import { createSessionCookie, getSessionUser, SESSION_COOKIE_NAME, SESSION_EXPIRES_IN_MS } from '@/lib/session';
import { isSystemRole } from '@/lib/roles';
import { RULES, clientIpFrom, loginLimiter } from '@/lib/rateLimit';
import { learnCurrent } from '@/lib/auth/passwordHashes';
import { audit } from '@/lib/audit';

// Deliberately identical for "unknown identifier" and "wrong password" — no
// enumeration oracle. See SECURITY_MODEL.md "Identity and login".
const GENERIC_ERROR = { error: 'Invalid username/email or password.' };

// Lock-outs are recorded in the audit log — once when each one starts, and at most LOCKOUT_LOG_MAX
// an hour per server instance, so a password-guessing campaign leaves a trace but can't be used
// to spend the database's daily write allowance.
const LOCKOUT_LOG_MAX = 20;
let lockoutLog = { hour: 0, count: 0 };
function recordLockout(identifier: string, ip: string) {
  const hour = Math.floor(Date.now() / 3_600_000);
  if (lockoutLog.hour !== hour) lockoutLog = { hour, count: 0 };
  if (++lockoutLog.count > LOCKOUT_LOG_MAX) return;
  const shown = identifier.trim().slice(0, 60).replace(/[\x00-\x1f]/g, '');
  audit(null, { action: 'SIGN_IN_LOCKED', actor: 'public', targetPersonId: null, details: `10 failed sign-ins for “${shown}” from ${ip.slice(0, 45)} — locked for 10 minutes${lockoutLog.count === LOCKOUT_LOG_MAX ? ' (further lock-outs this hour not recorded)' : ''}` })
    .catch((e) => console.error('Could not record a sign-in lock-out', e));
}

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
  const ip = clientIpFrom(request.headers);
  const attempt = loginLimiter.hit(RULES.loginPerAccount, `${ip}|${identifier.trim().toLowerCase()}`);
  if (!attempt.ok) {
    if (attempt.firstRefusal) recordLockout(identifier, ip);
    return NextResponse.json(
      { error: `Too many sign-in attempts — try again in ${Math.ceil(attempt.retryAfterSec / 60)} minute(s).` },
      { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSec) } }
    );
  }

  let idToken: string;
  let personId: string;
  try {
    ({ idToken, personId } = await loginWithIdentifier(identifier, password));
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
  // Remember this password's fingerprint for "new must differ from old" (never the password).
  await learnCurrent(personId, password).catch((err) => console.error('Could not record password fingerprint', err));

  await audit(null, { action: 'SIGNED_IN', actor: { personId, email: decoded.email ?? null, systemRole: decoded.systemRole }, targetPersonId: personId, details: decoded.mustChangePassword === true ? 'with a one-time password' : null })
    .catch((err: unknown) => console.error('Could not record sign-in', err));

  // After a reset the session is only good for choosing a new password (lib/session.ts).
  const mustChangePassword = decoded.mustChangePassword === true;
  const response = NextResponse.json({ systemRole: decoded.systemRole, mustChangePassword });
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
  const user = await getSessionUser().catch(() => null);
  if (user) await audit(null, { action: 'SIGNED_OUT', actor: user, targetPersonId: user.personId }).catch(() => {});
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
