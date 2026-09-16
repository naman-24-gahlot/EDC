// SERVER-ONLY. Reads/writes the session cookie and resolves the current user's
// systemRole from Firebase custom claims — never from anything client-supplied.
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebase/admin';
import { isSystemRole, type SystemRole } from '@/lib/roles';

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_EXPIRES_IN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export interface SessionUser {
  personId: string;
  email: string | null;
  systemRole: SystemRole;
}

export async function createSessionCookie(idToken: string): Promise<string> {
  return adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_EXPIRES_IN_MS });
}

/** Reads and verifies the session cookie for the current request. Null if absent/invalid. */
export async function getSessionUser(): Promise<SessionUser | null> {
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
}
