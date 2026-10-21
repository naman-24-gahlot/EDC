// SERVER-ONLY. Reads/writes the session cookie and resolves the current user's
// systemRole from Firebase custom claims — never from anything client-supplied.
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { adminAuth } from '@/lib/firebase/admin';
import { isSystemRole, type SystemRole } from '@/lib/roles';

export const SESSION_COOKIE_NAME = 'session';
const HOUR = 60 * 60 * 1000;
// Shorter for the accounts that can do the most: a Master session outlives one working day by
// a margin, a guard's covers a long shift. Members keep theirs for days so the pass is one tap.
export const SESSION_EXPIRES_IN_MS: Record<SystemRole, number> = {
  master: 12 * HOUR,
  guard: 16 * HOUR,
  member: 5 * 24 * HOUR,
};

export interface SessionUser {
  personId: string;
  email: string | null;
  systemRole: SystemRole;
}

export async function createSessionCookie(idToken: string, role: SystemRole): Promise<string> {
  return adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_EXPIRES_IN_MS[role] });
}

/**
 * For PAGES: verify the session and role inside the page itself — never rely on a layout,
 * which Next skips on client-side navigation. Redirects to /login otherwise — with
 * ?expired=1 when a session existed but has ended (timed out, revoked, signed out elsewhere),
 * and to /set-password while a reset's new password is still owed.
 */
export async function requirePageRole(...roles: SystemRole[]): Promise<SessionUser> {
  const session = await readSession();
  if (session.state === 'must-change') redirect('/set-password');
  if (session.state === 'ended') redirect('/login?expired=1');
  if (session.state !== 'ok' || !roles.includes(session.user.systemRole)) redirect('/login');
  return session.user;
}

type Session =
  | { state: 'none' | 'ended' }
  | { state: 'ok' | 'must-change'; user: SessionUser };

/** Memoised per request (React `cache`), so a layout and its page verify once, not twice. */
const readSession = cache(async function readSession(): Promise<Session> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return { state: 'none' };

  try {
    // `true` = check the session cookie hasn't been revoked (e.g. Master deactivating
    // the account, or demoting/promoting, mid-session).
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (!isSystemRole(decoded.systemRole)) return { state: 'ended' };
    const user = { personId: decoded.uid, email: decoded.email ?? null, systemRole: decoded.systemRole };
    return { state: decoded.mustChangePassword === true ? 'must-change' : 'ok', user };
  } catch {
    return { state: 'ended' };
  }
});

/**
 * The signed-in user for every page and API. Null if absent/invalid — and ALSO null while the
 * person still has to replace a one-time password, so nothing else in the app works for them
 * until they do (fail closed: no route needs to remember to check).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const s = await readSession();
  return s.state === 'ok' ? s.user : null;
}

/** Only for the set-password page and API: the session that must pick a new password. */
export async function getPasswordResetSession(): Promise<SessionUser | null> {
  const s = await readSession();
  return s.state === 'must-change' ? s.user : null;
}
