// SERVER-ONLY. Resolves any of the three login identifiers (username / EDC email /
// communication email) to a person, then verifies the password server-side via the
// Firebase Auth REST API. The canonical account email never reaches the client.
// See SECURITY_MODEL.md "Identity and login".
if (typeof window !== 'undefined') {
  throw new Error('lib/auth/login.ts must never be imported into client code.');
}

import { adminAuth, adminDb } from '@/lib/firebase/admin';

/** Thrown for ANY login failure — unknown identifier, wrong password, disabled account.
 * The caller must respond identically regardless of which one occurred (no enumeration). */
export class LoginError extends Error {}

async function resolvePersonId(identifier: string): Promise<string | null> {
  const key = identifier.trim().toLowerCase();
  if (!key) return null;
  const snap = await adminDb.collection('identifiers').doc(key).get();
  const personId = snap.data()?.personId;
  return typeof personId === 'string' ? personId : null;
}

async function signInWithPasswordREST(email: string, password: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!apiKey) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.idToken !== 'string') {
    throw new LoginError('Invalid credentials');
  }
  return body.idToken;
}

/**
 * identifier -> person -> password check -> a fresh ID token ready to exchange for a
 * session cookie. Throws LoginError for every failure mode so the route can return one
 * generic response no matter which step failed.
 */
export async function loginWithIdentifier(
  identifier: string,
  password: string
): Promise<{ idToken: string; personId: string }> {
  const personId = await resolvePersonId(identifier);
  if (!personId) throw new LoginError('Invalid credentials');

  let email: string;
  try {
    const record = await adminAuth.getUser(personId);
    if (!record.email) throw new LoginError('Invalid credentials');
    email = record.email;
  } catch (err) {
    if (err instanceof LoginError) throw err;
    throw new LoginError('Invalid credentials');
  }

  const idToken = await signInWithPasswordREST(email, password);
  return { idToken, personId };
}
