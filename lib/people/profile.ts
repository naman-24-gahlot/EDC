// SERVER-ONLY. Editing a person's own details, and password changes/resets.
// Username and emails are deliberately NOT editable here: they're login identifiers with
// uniqueness reservations (identifiers/), and changing them safely is a separate flow.
if (typeof window !== 'undefined') {
  throw new Error('lib/people/profile.ts must never be imported into client code.');
}

import { randomBytes } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, loadPerson, requireMaster } from '@/lib/hierarchy/authorize';
import { validatePhoto } from './create';
import { checkMobile } from '@/lib/phone';
import { hashPassword, matches, readHashes, writeHashes } from '@/lib/auth/passwordHashes';
import { audit, eventIdOf, lookupEventId } from '@/lib/audit';
import { assertGoodPassword } from '@/lib/auth/passwordPolicy';
import { identityToolkit, sendPasswordReset, actionErrorMessage } from '@/lib/auth/emailActions';
import { personTouched } from '@/lib/people/peopleIndex';
import { assertAddressAllowed } from '@/lib/testMode';

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  mobile?: string;
  purpose?: string;
  photoDataUrl?: string | null;
  /** Optional second address for password resets and approval emails. Only the person sets it. */
  backupEmail?: string | null;
}

// Same shape rule as the main email (lib/people/create.ts); not verified, not a login identifier.
const BACKUP_EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u;

/** Validates untrusted input; only known fields survive. Throws 400. */
export function parseProfilePatch(input: unknown, opts: { self?: boolean } = {}): ProfilePatch {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Invalid profile fields.');
  const raw = input as Record<string, unknown>;
  const out: ProfilePatch = {};
  for (const key of ['firstName', 'lastName'] as const) {
    if (key in raw) {
      const v = typeof raw[key] === 'string' ? (raw[key] as string).trim() : '';
      if (!NAME_RE.test(v)) throw new HttpError(400, `${key === 'firstName' ? 'First' : 'Last'} name must be 1–60 letters.`);
      out[key] = v;
    }
  }
  if ('mobile' in raw) {
    const m = checkMobile(typeof raw.mobile === 'string' ? raw.mobile : '');
    if (!m.ok) throw new HttpError(400, m.message ?? 'Enter a valid mobile number.');
    out.mobile = m.value!;
  }
  if ('purpose' in raw) {
    const v = typeof raw.purpose === 'string' ? raw.purpose.trim() : '';
    if (!v || v.length > 200) throw new HttpError(400, 'Profile / purpose must be 1–200 characters.');
    out.purpose = v;
  }
  if ('photoDataUrl' in raw) {
    if (raw.photoDataUrl !== null && typeof raw.photoDataUrl !== 'string') throw new HttpError(400, 'Invalid photo.');
    out.photoDataUrl = validatePhoto(raw.photoDataUrl as string | null);
  }
  if ('backupEmail' in raw) {
    // Someone else setting it could route password resets to themselves.
    if (!opts.self) throw new HttpError(403, 'Only the person can set their backup email.');
    out.backupEmail = parseBackupEmail(raw.backupEmail);
  }
  if (Object.keys(out).length === 0) throw new HttpError(400, 'Nothing to change.');
  return out;
}

/** null/'' clears it. Throws 400 for anything that isn't an email address. */
export function parseBackupEmail(v: unknown): string | null {
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) return null;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!BACKUP_EMAIL_RE.test(s) || s.length > 254) throw new HttpError(400, 'Enter a valid backup email, or leave it empty.');
  return s;
}

/** Self, Master, or an ancestor. */
export async function updateProfile(actor: SessionUser, personId: string, patch: ProfilePatch) {
  if (personId !== actor.personId) await assertCanActOn(actor, personId);
  const person = await loadPerson(personId);
  if (!person) throw new HttpError(404, 'Person not found.');
  await assertAddressAllowed(patch.backupEmail);
  if (patch.backupEmail && patch.backupEmail === String(person.commEmail ?? '').toLowerCase()) {
    throw new HttpError(400, 'Your backup email must be different from your main email.');
  }

  const batch = adminDb.batch();
  batch.update(adminDb.collection('people').doc(personId), { ...patch, ...personTouched() });
  audit(batch, {
    action: 'PROFILE_UPDATED', actor, targetPersonId: personId, eventId: eventIdOf(person),
    details: `changed: ${Object.keys(patch).join(', ')}`,
  });
  await batch.commit();
  if (patch.firstName || patch.lastName) {
    await adminAuth.updateUser(personId, { displayName: `${patch.firstName ?? person.firstName} ${patch.lastName ?? person.lastName}` }).catch(() => {});
  }
  return { personId, changed: Object.keys(patch) };
}

export async function passwordSignIn(email: string, password: string): Promise<string | null> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json().catch(() => null);
  return res.ok && typeof body?.idToken === 'string' ? body.idToken : null;
}

/** The rules (length, common, own details, known breaches) with this person's details. */
async function checkNewPassword(pw: unknown, personId: string): Promise<string> {
  const [person, record] = await Promise.all([loadPerson(personId), adminAuth.getUser(personId)]);
  return assertGoodPassword(pw, { username: person?.username, email: record.email, name: person ? `${person.firstName} ${person.lastName}` : undefined });
}

/**
 * Self-service. Verifies the current password, sets the new one, and signs out every other
 * device (revokes all sessions). Returns a fresh ID token so the caller can keep THIS device
 * signed in.
 */
export async function changeOwnPassword(actor: SessionUser, current: unknown, next: unknown): Promise<string> {
  if (typeof current !== 'string' || !current) throw new HttpError(400, 'Enter your current password.');
  const newPassword = await checkNewPassword(next, actor.personId);
  if (newPassword === current) throw new HttpError(400, 'The new password must be different.');
  const record = await adminAuth.getUser(actor.personId);
  if (!record.email || !(await passwordSignIn(record.email, current))) throw new HttpError(403, 'Current password is incorrect.');

  const hashes = await readHashes(actor.personId);
  if (await matches(newPassword, hashes.previous)) throw new HttpError(400, 'Pick a password you have not used just before.');

  await adminAuth.updateUser(actor.personId, { password: newPassword });
  await writeHashes(actor.personId, { previous: await hashPassword(current), current: await hashPassword(newPassword), oneTime: null });
  await adminAuth.revokeRefreshTokens(actor.personId);
  await audit(null, { action: 'PASSWORD_CHANGED', actor, targetPersonId: actor.personId, eventId: await lookupEventId(actor.personId), details: 'other sessions signed out' });
  // Revocation is recorded to the second; a token minted in that same second could be judged
  // revoked too, so wait past the boundary before signing this device back in.
  await new Promise((r) => setTimeout(r, 1100));
  const idToken = await passwordSignIn(record.email, newPassword);
  if (!idToken) throw new HttpError(500, 'Password changed — please sign in again.');
  return idToken;
}

/** Master only, never self. Sets a one-time password and signs the person out everywhere. */
export async function resetPassword(actor: SessionUser, personId: string): Promise<string> {
  requireMaster(actor);
  if (personId === actor.personId) throw new HttpError(400, 'Change your own password from your account page.');
  const person = await loadPerson(personId);
  if (!person) throw new HttpError(404, 'Person not found.');
  if (person.hasAccount === false) throw new HttpError(400, 'Visitors have no sign-in account, so there’s no password to reset.');
  const password = randomBytes(9).toString('base64url');
  // The password they had stays on record as "previous" (a fingerprint, not the password) so the
  // one they must now choose can't be the same. A second reset before they finish keeps it.
  const hashes = await readHashes(personId);
  await writeHashes(personId, { previous: hashes.current ?? hashes.previous, current: null, oneTime: await hashPassword(password) });
  const claims = (await adminAuth.getUser(personId)).customClaims ?? {};
  // Claim first: if the password update below fails, they're still made to change it on sign-in.
  await adminAuth.setCustomUserClaims(personId, { ...claims, mustChangePassword: true });
  await adminAuth.updateUser(personId, { password });
  await adminAuth.revokeRefreshTokens(personId);
  await audit(null, { action: 'PASSWORD_RESET', actor, targetPersonId: personId, eventId: eventIdOf(person), details: 'one-time password issued; sessions signed out' });
  return password;
}

/**
 * Finishing a reset: the person signed in with the one-time password and must now pick a new
 * one that is neither the one-time password nor the password they had before the reset. Safe
 * to retry: if the change already went through, the same new password just signs them in.
 */
export async function completePasswordReset(personId: string, next: unknown): Promise<string> {
  const newPassword = await checkNewPassword(next, personId);
  const record = await adminAuth.getUser(personId);
  if (!record.email) throw new HttpError(500, 'Account has no sign-in email.');
  const hashes = await readHashes(personId);
  const claims = record.customClaims ?? {};

  if (claims.mustChangePassword === true) {
    if (await matches(newPassword, hashes.oneTime)) throw new HttpError(400, 'Choose your own password — not the one-time password.');
    if (await matches(newPassword, hashes.previous)) throw new HttpError(400, 'That is your old password. Choose a new one you have not used before.');
    await adminAuth.updateUser(personId, { password: newPassword });
    await writeHashes(personId, { current: await hashPassword(newPassword), oneTime: null, previous: null });
    // Password first, then the flag: a failure in between leaves them asked again — never let through.
    const { mustChangePassword: _done, ...rest } = claims; // eslint-disable-line @typescript-eslint/no-unused-vars -- dropping the flag
    await adminAuth.setCustomUserClaims(personId, rest);
    await adminAuth.revokeRefreshTokens(personId);
    const role = claims.systemRole === 'master' || claims.systemRole === 'guard' ? claims.systemRole : 'member';
    await audit(null, {
      action: 'PASSWORD_CHANGED', actor: { personId, email: record.email, systemRole: role }, targetPersonId: personId,
      eventId: await lookupEventId(personId), details: 'new password set after a reset',
    });
    await new Promise((r) => setTimeout(r, 1100)); // see changeOwnPassword: revocation is per second
  } else if (!(await matches(newPassword, hashes.current))) {
    // Already finished (e.g. the first attempt's reply was lost) and this isn't that password.
    throw new HttpError(409, 'Your new password is already set — sign in with it.');
  }
  const idToken = await passwordSignIn(record.email, newPassword);
  if (!idToken) throw new HttpError(500, 'Password saved — please sign in with your new password.');
  return idToken;
}

/** Self-service "sign out of all devices". */
export async function signOutEverywhere(actor: SessionUser) {
  await adminAuth.revokeRefreshTokens(actor.personId);
  await audit(null, { action: 'SESSIONS_REVOKED', actor, targetPersonId: actor.personId, eventId: await lookupEventId(actor.personId) });
}

// ---- Forgot password / verify email (links from lib/auth/emailActions.ts) ---------------------

/**
 * "Forgot password": emails a reset link if the identifier belongs to an approved, active
 * account. Says nothing either way — the caller answers the same whatever happens, so the form
 * can't be used to find out who has an account.
 */
export async function requestPasswordReset(identifier: unknown, origin: string): Promise<void> {
  if (typeof identifier !== 'string') return;
  const key = identifier.trim().toLowerCase();
  if (!key || key.length > 254 || key.includes('/')) return;
  const personId = (await adminDb.collection('identifiers').doc(key).get()).data()?.personId;
  if (typeof personId !== 'string') return;
  const person = await loadPerson(personId);
  if (!person || person.registrationStatus !== 'APPROVED' || !person.active) return;
  await sendPasswordReset(personId, origin);
  await audit(null, { action: 'PASSWORD_RESET_EMAIL_SENT', actor: 'public', targetPersonId: personId, eventId: eventIdOf(person), details: 'requested from "Forgot password"' });
}

/** Who a reset link is for (masked email), without using it up. Throws HttpError 400 if invalid/expired. */
export async function inspectResetCode(oobCode: unknown): Promise<{ email: string; ctx: { email: string; username?: string; name?: string } }> {
  if (typeof oobCode !== 'string' || !oobCode || oobCode.length > 512) throw new HttpError(400, 'This link is not valid.');
  try {
    const { email } = await identityToolkit<{ email: string }>('accounts:resetPassword', { oobCode });
    const [user, domain] = email.split('@');
    const person = await adminAuth.getUserByEmail(email).then((u) => loadPerson(u.uid)).catch(() => null);
    return {
      email: `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`,
      ctx: { email, username: person?.username, name: person ? `${person.firstName} ${person.lastName}` : undefined },
    };
  } catch (err) {
    throw new HttpError(400, actionErrorMessage(err));
  }
}

/**
 * Finishes "forgot password": the same rules as any new password, plus not the current or the
 * previous one. Using the link proves they own the inbox, so their email counts as verified.
 */
export async function completeEmailReset(oobCode: unknown, next: unknown): Promise<void> {
  if (typeof oobCode !== 'string' || !oobCode) throw new HttpError(400, 'This link is not valid.');
  let email: string;
  try {
    ({ email } = await identityToolkit<{ email: string }>('accounts:resetPassword', { oobCode }));
  } catch (err) {
    throw new HttpError(400, actionErrorMessage(err));
  }
  const user = await adminAuth.getUserByEmail(email);
  const newPassword = await checkNewPassword(next, user.uid);
  const hashes = await readHashes(user.uid);
  if ((await matches(newPassword, hashes.current)) || (await matches(newPassword, hashes.previous))) {
    throw new HttpError(400, 'That is a password you used recently. Choose a new one.');
  }
  try {
    await identityToolkit('accounts:resetPassword', { oobCode, newPassword }); // uses the link up
  } catch (err) {
    throw new HttpError(400, actionErrorMessage(err));
  }
  await writeHashes(user.uid, { previous: hashes.current, current: await hashPassword(newPassword), oneTime: null });
  const { mustChangePassword: _done, ...claims } = user.customClaims ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars -- a pending forced change is satisfied too
  await adminAuth.setCustomUserClaims(user.uid, claims);
  await adminAuth.updateUser(user.uid, { emailVerified: true });
  await adminAuth.revokeRefreshTokens(user.uid);
  await adminDb.collection('people').doc(user.uid).update({ emailVerified: true, ...personTouched() }).catch(() => {});
  await audit(null, {
    action: 'PASSWORD_CHANGED', actor: { personId: user.uid, email, systemRole: claims.systemRole === 'master' || claims.systemRole === 'guard' ? claims.systemRole : 'member' },
    targetPersonId: user.uid, eventId: await lookupEventId(user.uid), details: 'reset with an email link; signed out everywhere',
  });
}

/** Applies an email-verification link. */
export async function applyEmailVerification(oobCode: unknown): Promise<void> {
  if (typeof oobCode !== 'string' || !oobCode || oobCode.length > 512) throw new HttpError(400, 'This link is not valid.');
  let email: string;
  try {
    ({ email } = await identityToolkit<{ email: string }>('accounts:update', { oobCode }));
  } catch (err) {
    throw new HttpError(400, actionErrorMessage(err));
  }
  const user = await adminAuth.getUserByEmail(email);
  await adminDb.collection('people').doc(user.uid).update({ emailVerified: true, ...personTouched() }).catch(() => {});
  await audit(null, { action: 'EMAIL_VERIFIED', actor: { personId: user.uid, email, systemRole: 'member' }, targetPersonId: user.uid, eventId: await lookupEventId(user.uid) });
}
