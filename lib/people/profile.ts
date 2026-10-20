// SERVER-ONLY. Editing a person's own details, and password changes/resets.
// Username and emails are deliberately NOT editable here: they're login identifiers with
// uniqueness reservations (identifiers/), and changing them safely is a separate flow.
if (typeof window !== 'undefined') {
  throw new Error('lib/people/profile.ts must never be imported into client code.');
}

import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, loadPerson, requireMaster } from '@/lib/hierarchy/authorize';
import { validatePhoto } from './create';

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
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'PROFILE_UPDATED',
    actorId: actor.personId,
    actorRole: actor.systemRole,
    targetPersonId: personId,
    subjectId: null,
    timestamp: Timestamp.now(),
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

  await adminAuth.updateUser(actor.personId, { password: newPassword });
  await adminAuth.revokeRefreshTokens(actor.personId);
  await adminDb.collection('auditLogs').add({
    action: 'PASSWORD_CHANGED', actorId: actor.personId, actorRole: actor.systemRole,
    targetPersonId: actor.personId, subjectId: null, timestamp: Timestamp.now(), details: 'other sessions signed out',
  });
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
  await adminAuth.updateUser(personId, { password });
  await adminAuth.revokeRefreshTokens(personId);
  await adminDb.collection('auditLogs').add({
    action: 'PASSWORD_RESET', actorId: actor.personId, actorRole: actor.systemRole,
    targetPersonId: personId, subjectId: null, timestamp: Timestamp.now(), details: 'one-time password issued; sessions signed out',
  });
  return password;
}

/** Self-service "sign out of all devices". */
export async function signOutEverywhere(actor: SessionUser) {
  await adminAuth.revokeRefreshTokens(actor.personId);
  await adminDb.collection('auditLogs').add({
    action: 'SESSIONS_REVOKED', actorId: actor.personId, actorRole: actor.systemRole,
    targetPersonId: actor.personId, subjectId: null, timestamp: Timestamp.now(), details: null,
  });
}
