// SERVER-ONLY. Password-reset and email-verification emails, using Firebase Auth's own free
// email sending (Spark plan) — no email provider account needed.
//
// Real addresses: Firebase emails the link (its template; the link opens /auth/action once the
// console's action URL points there — DEPLOYMENT.md). Test addresses (any domain ending in
// ".test", e.g. qa1@example.test, which can never receive mail): nothing is sent; the link
// goes to the Master-only test outbox (/admin/outbox), so testing needs no real inboxes.
if (typeof window !== 'undefined') {
  throw new Error('lib/auth/emailActions.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { toPerson } from '@/lib/hierarchy/authorize';
import { sendOwnResetEmail, sendOwnVerifyEmail, sendResetToBackup } from '@/lib/notify';
import { mailConfigured } from '@/lib/mail';

const API = 'https://identitytoolkit.googleapis.com/v1';
const key = () => {
  const k = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!k) throw new Error('NEXT_PUBLIC_FIREBASE_API_KEY is not set');
  return k;
};

/** Firebase Auth REST call. Returns the body, or throws with Firebase's error code (e.g. "EXPIRED_OOB_CODE"). */
export async function identityToolkit<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}/${path}?key=${key()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new EmailActionError(String(data?.error?.message ?? `HTTP ${res.status}`));
  return data as T;
}

export class EmailActionError extends Error {}

export const isTestAddress = (email: string) => /\.test$/i.test(email.split('@')[1] ?? '');

type Kind = 'resetPassword' | 'verifyEmail';

/** Our own handler for a Firebase action link: keeps only the one-time code from it. */
function ourLink(firebaseLink: string, origin: string, mode: Kind): string {
  const code = new URL(firebaseLink).searchParams.get('oobCode');
  if (!code) throw new Error('Firebase returned a link without a code.');
  return `${origin}/auth/action?mode=${mode}&oobCode=${encodeURIComponent(code)}`;
}

async function toOutbox(personId: string, to: string, kind: Kind, link: string) {
  await adminDb.collection('testOutbox').add({ personId, to, kind, link, createdAt: Timestamp.now() });
}

/** Sends (or, for a test address, files in the outbox) a password-reset link. */
export async function sendPasswordReset(personId: string, origin: string): Promise<void> {
  const { email } = await adminAuth.getUser(personId);
  if (!email) return;
  const person = toPerson(await adminDb.collection('people').doc(personId).get());
  // A second copy for the backup email, if they added one (a fresh link of its own).
  if (person && typeof person.backupEmail === 'string' && person.backupEmail) {
    await sendResetToBackup(person, ourLink(await adminAuth.generatePasswordResetLink(email), origin, 'resetPassword'));
  }
  if (isTestAddress(email)) return toOutbox(personId, email, 'resetPassword', ourLink(await adminAuth.generatePasswordResetLink(email), origin, 'resetPassword'));
  // With our own mailer set up, send it ourselves so the link opens OUR page (/auth/action): Firebase
  // won't let this project change its template's action URL, and its own page skips our password rules.
  if (mailConfigured() && person) {
    await sendOwnResetEmail(person, email, ourLink(await adminAuth.generatePasswordResetLink(email), origin, 'resetPassword'));
    return;
  }
  await identityToolkit('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });
}

/**
 * Sends (or files) an email-verification link. Firebase only sends these on behalf of a signed-in
 * user, so the server signs in as them with a one-off custom token — no password needed.
 */
export async function sendEmailVerification(personId: string, origin: string): Promise<void> {
  const user = await adminAuth.getUser(personId);
  if (!user.email || user.emailVerified) return;
  if (isTestAddress(user.email)) return toOutbox(personId, user.email, 'verifyEmail', ourLink(await adminAuth.generateEmailVerificationLink(user.email), origin, 'verifyEmail'));
  if (mailConfigured()) {
    await sendOwnVerifyEmail(personId, user.displayName ?? '', user.email, ourLink(await adminAuth.generateEmailVerificationLink(user.email), origin, 'verifyEmail'));
    return;
  }
  const { idToken } = await identityToolkit<{ idToken: string }>('accounts:signInWithCustomToken', { token: await adminAuth.createCustomToken(personId), returnSecureToken: true });
  await identityToolkit('accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });
}

/** Plain-language messages for Firebase's action-code errors. */
export function actionErrorMessage(err: unknown): string {
  const code = err instanceof EmailActionError ? err.message : '';
  if (code.startsWith('EXPIRED_OOB_CODE')) return 'This link has expired. Ask for a new one.';
  if (code.startsWith('INVALID_OOB_CODE')) return 'This link has already been used or is not valid. Ask for a new one.';
  if (code.startsWith('USER_DISABLED')) return 'This account is switched off. Contact the EDC office.';
  if (code.startsWith('USER_NOT_FOUND')) return 'This account no longer exists.';
  return 'Something went wrong with this link. Ask for a new one.';
}
