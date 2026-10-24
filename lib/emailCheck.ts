// SERVER-ONLY. "Confirm your email before you can register." Nobody has an account yet, and
// Firebase only sends its verify/reset emails to existing accounts — but its free "email link"
// (passwordless sign-in) email can go to any address. We use that link purely as proof the
// person owns the inbox, then delete the throwaway account it creates. Test addresses (*.test)
// skip Firebase: a one-off token, link in the Master's test outbox.
//
// emailChecks/{email}: { email, requestedAt, verifiedAt | null, expiresAt | null, tokenHash? }
// Confirmed lasts CONFIRMED_FOR_MS; registration consumes it (lib → /api/register).
if (typeof window !== 'undefined') {
  throw new Error('lib/emailCheck.ts must never be imported into client code.');
}

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { HttpError } from '@/lib/hierarchy/authorize';
import { identityToolkit, isTestAddress, EmailActionError } from '@/lib/auth/emailActions';
import { checkEmail } from '@/lib/registrationChecks';
import { audit } from '@/lib/audit';

export const CONFIRMED_FOR_MS = 24 * 60 * 60 * 1000; // time to finish the form after confirming
const TEST_LINK_FOR_MS = 24 * 60 * 60 * 1000;
const RESEND_AFTER_MS = 45 * 1000;

const keyOf = (email: string) => email.trim().toLowerCase();
const ref = (email: string) => adminDb.collection('emailChecks').doc(keyOf(email));
const sha = (s: string) => createHash('sha256').update(s).digest();

/** Sends the confirmation link (or files it in the test outbox). Throws HttpError with a plain message. */
export async function requestEmailCheck(rawEmail: unknown, origin: string): Promise<void> {
  if (typeof rawEmail !== 'string') throw new HttpError(400, 'Enter your email address.');
  const email = rawEmail.trim();
  const verdict = await checkEmail(email); // format, typo, throwaway, already registered, can receive mail
  if (!verdict.ok) throw new HttpError(400, verdict.message ?? 'That email can’t be used.');
  const existing = (await ref(email).get()).data();
  if (existing?.requestedAt && Date.now() - existing.requestedAt.toMillis() < RESEND_AFTER_MS) {
    throw new HttpError(429, 'We just sent a link — check your inbox (and spam). You can send another in a minute.');
  }
  const confirmUrl = `${origin}/register/confirm?email=${encodeURIComponent(email)}`;
  const now = Timestamp.now();

  if (isTestAddress(email)) {
    const token = randomBytes(24).toString('base64url');
    await ref(email).set({ email, requestedAt: now, verifiedAt: null, expiresAt: null, tokenHash: sha(token).toString('base64url'), tokenExpiresAt: Timestamp.fromMillis(Date.now() + TEST_LINK_FOR_MS) });
    await adminDb.collection('testOutbox').add({ personId: null, to: email, kind: 'confirmEmail', link: `${confirmUrl}&token=${token}`, createdAt: now });
    return;
  }
  try {
    await identityToolkit('accounts:sendOobCode', { requestType: 'EMAIL_SIGNIN', email, continueUrl: confirmUrl, canHandleCodeInApp: true });
  } catch (err) {
    const code = err instanceof EmailActionError ? err.message : '';
    if (code.startsWith('TOO_MANY_ATTEMPTS')) throw new HttpError(429, 'Too many emails to this address just now — try again in a few minutes.');
    if (code.startsWith('OPERATION_NOT_ALLOWED') || code.includes('UNAUTHORIZED')) {
      console.error('Email-link sign-in is not enabled / domain not authorized in Firebase', code);
      throw new HttpError(503, 'Email confirmation isn’t switched on yet. Please tell the EDC office.');
    }
    throw err;
  }
  await ref(email).set({ email, requestedAt: now, verifiedAt: null, expiresAt: null });
}

/** Is this email confirmed and still within its window? */
export async function isEmailConfirmed(email: string): Promise<boolean> {
  const d = (await ref(email).get()).data();
  return !!d?.verifiedAt && !!d.expiresAt && d.expiresAt.toMillis() > Date.now();
}

/**
 * The link was opened. Firebase links: sign in with the link (proves the inbox) and delete the
 * throwaway account if it has no profile. Test links: compare the token. Returns the email.
 */
export async function confirmEmailCheck(params: { email?: string; oobCode?: string; token?: string }): Promise<string> {
  const email = (params.email ?? '').trim();
  if (!email || email.length > 254) throw new HttpError(400, 'This link is incomplete — open it exactly as it was emailed.');
  if (params.token) {
    const d = (await ref(email).get()).data();
    const ok = d?.tokenHash && d.tokenExpiresAt?.toMillis() > Date.now()
      && timingSafeEqual(Buffer.from(d.tokenHash, 'base64url'), sha(params.token));
    if (!ok) throw new HttpError(400, 'This link has expired or was replaced by a newer one. Send a new one from the form.');
  } else if (params.oobCode) {
    let uid: string;
    try {
      ({ localId: uid } = await identityToolkit<{ localId: string }>('accounts:signInWithEmailLink', { email, oobCode: params.oobCode }));
    } catch (err) {
      const code = err instanceof EmailActionError ? err.message : '';
      if (code.startsWith('INVALID_EMAIL')) throw new HttpError(400, 'This link was sent to a different email address.');
      throw new HttpError(400, 'This link has expired or was already used. Send a new one from the form.');
    }
    // Only a throwaway (no profile) is removed; a real account would never reach this (taken emails can't request a link).
    if (!(await adminDb.collection('people').doc(uid).get()).exists) await adminAuth.deleteUser(uid).catch(() => {});
  } else {
    throw new HttpError(400, 'This link is incomplete — open it exactly as it was emailed.');
  }
  const now = Date.now();
  await ref(email).set({ verifiedAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + CONFIRMED_FOR_MS), tokenHash: null }, { merge: true });
  await audit(null, { action: 'REGISTRATION_EMAIL_CONFIRMED', actor: 'public', targetPersonId: null, subjectId: email, details: 'confirmed before registering (valid 24 h)' }).catch(() => {});
  return email;
}

/** Registration done: the confirmation is used up. */
export async function consumeEmailCheck(email: string): Promise<void> {
  await ref(email).delete().catch(() => {});
}
