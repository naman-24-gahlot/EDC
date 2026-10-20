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
 * which Next skips on client-side navigation. Redirects to /login otherwise.
 */
export async function requirePageRole(...roles: SystemRole[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !roles.includes(user.systemRole)) redirect('/login');
  return user;
}

/**
 * Reads and verifies the session cookie for the current request. Null if absent/invalid.
 * Memoised per request (React `cache`), so a layout and its page verify once, not twice.
 */
export const getSessionUser = cache(async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!sessionCookie) return null;

  try {
    // `true` = check the session cookie hasn't been revoked (e.g. Master deactivating
    // the account, or demoting/promoting, mid-session).
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (!isSystemRole(decoded.systemRole)) return null;
    return { personId: decoded.uid, email: decoded.email ?? null, systemRole: decoded.systemRole };
  } catch {
    return null;
  }
});
