// SERVER-ONLY. Reads/writes the session cookie and resolves the current user's role
// from Firebase custom claims — never from anything client-supplied.
import { cookies } from 'next/headers';
import { adminAuth } from '@/lib/firebase/admin';
import { isRole, type Role } from '@/lib/roles';

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_EXPIRES_IN_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

export interface SessionUser {
  uid: string;
  email: string | null;
  role: Role;
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
    // `true` = check the session cookie hasn't been revoked (e.g. an admin
    // deactivating the account mid-session).
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);
    if (!isRole(decoded.role)) return null;
    return { uid: decoded.uid, email: decoded.email ?? null, role: decoded.role };
  } catch {
    return null;
  }
}
