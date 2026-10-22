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
import { hashPassword, matches, readHashes, writeHashes } from '@/lib/auth/passwordHashes';
import { audit, eventIdOf, lookupEventId } from '@/lib/audit';

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  mobile?: string;
  purpose?: string;
  photoDataUrl?: string | null;
}

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u;
const MOBILE_RE = /^\+?[0-9][0-9 -]{5,19}$/;

/** Validates untrusted input; only known fields survive. Throws 400. */
export function parseProfilePatch(input: unknown): ProfilePatch {
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
    const v = typeof raw.mobile === 'string' ? raw.mobile.trim() : '';
    if (!MOBILE_RE.test(v)) throw new HttpError(400, 'Mobile number must be 6–20 digits (spaces, dashes and a leading + allowed).');
    out.mobile = v;
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
  if (Object.keys(out).length === 0) throw new HttpError(400, 'Nothing to change.');
  return out;
}

/** Self, Master, or an ancestor. */
export async function updateProfile(actor: SessionUser, personId: string, patch: ProfilePatch) {
  if (personId !== actor.personId) await assertCanActOn(actor, personId);
  const person = await loadPerson(personId);
  if (!person) throw new HttpError(404, 'Person not found.');

  const batch = adminDb.batch();
  batch.update(adminDb.collection('people').doc(personId), { ...patch });
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

async function passwordSignIn(email: string, password: string): Promise<string | null> {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json().catch(() => null);
  return res.ok && typeof body?.idToken === 'string' ? body.idToken : null;
}

function checkNewPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) throw new HttpError(400, 'New password must be 8–128 characters.');
  return pw;
}

/**
 * Self-service. Verifies the current password, sets the new one, and signs out every other
 * device (revokes all sessions). Returns a fresh ID token so the caller can keep THIS device
 * signed in.
 */
export async function changeOwnPassword(actor: SessionUser, current: unknown, next: unknown): Promise<string> {
  if (typeof current !== 'string' || !current) throw new HttpError(400, 'Enter your current password.');
  const newPassword = checkNewPassword(next);
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
  const newPassword = checkNewPassword(next);
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
