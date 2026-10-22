// SERVER-ONLY. Creates a person: a Firebase Auth account plus the
// people/identifiers(+accessNumbers) Firestore docs. See DATABASE_SCHEMA.md "people",
// "identifiers", "accessNumbers" and the Registration state machine.
if (typeof window !== 'undefined') {
  throw new Error('lib/people/create.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import type { SystemRole } from '@/lib/roles';
import { type ProfileType, accessCodeFor, issueAccessNumber } from '@/lib/access/codes';
import { HttpError, computeAncestorIds, loadPerson } from '@/lib/hierarchy/authorize';
import { hashPassword, writeHashes } from '@/lib/auth/passwordHashes';

export const PersonCreateError = HttpError;

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
// Deliberately narrower than RFC 5322: the address becomes a Firestore document id
// (identifiers/{email}), so '/' and whitespace must never get through.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const MAX_PHOTO_BYTES = 150 * 1024;
const PHOTO_DATA_URL_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/;

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 6) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('ALREADY_EXISTS');
}

function authCode(err: unknown): unknown {
  return err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
}

export function validatePhoto(photoDataUrl: string | null): string | null {
  if (photoDataUrl === null) return null;
  const match = photoDataUrl.match(PHOTO_DATA_URL_RE);
  if (!match) {
    throw new PersonCreateError(400, 'Photo must be a JPEG data URL (client-downscaled).');
  }
  const approxBytes = (match[1].length * 3) / 4;
  if (approxBytes > MAX_PHOTO_BYTES) {
    throw new PersonCreateError(400, 'Photo is too large — it should be downscaled to under 150KB.');
  }
  return photoDataUrl;
}

export interface CreatePersonInput {
  firstName: string;
  lastName: string;
  username: string; // raw; lowercased + validated here
  commEmail: string; // raw; lowercased only for the identifiers key
  mobile: string;
  purpose: string;
  profileType: ProfileType | null; // null only for guards
  password: string;
  photoDataUrl: string | null;
}

export interface CreatePersonOptions {
  createdBy: string; // personId, or 'self' for public registration
  parentId: string | null;
  /** Registered through an event link: which event, and where the link was shared (utm tags). */
  event?: { eventId: string; eventName: string; source: { source: string | null; medium: string | null; campaign: string | null } };
  registrationStatus: 'PENDING' | 'APPROVED';
  systemRole?: SystemRole; // defaults to 'member'
}

export interface CreatedPerson {
  personId: string;
  username: string;
  commEmail: string;
  accessNumber: string | null;
  accessCode: string | null;
}

/**
 * Creates the Auth account for a person whose identifiers we already hold. An existing
 * Auth account with this email can't be one of ours mid-creation (we hold the identifier
 * reservation), so if it has no profile it was created outside the app — e.g. directly
 * against the public Firebase REST API to squat the address — and is removed.
 */
async function createAuthUser(uid: string, email: string, password: string, displayName: string) {
  try {
    await adminAuth.createUser({ uid, email, password, displayName, emailVerified: false });
    return;
  } catch (err) {
    if (authCode(err) !== 'auth/email-already-exists') throw err;
  }
  const existing = await adminAuth.getUserByEmail(email);
  if ((await adminDb.collection('people').doc(existing.uid).get()).exists) {
    throw new PersonCreateError(409, 'That email is already registered.');
  }
  await adminAuth.deleteUser(existing.uid);
  await adminDb.collection('auditLogs').add({
    action: 'ORPHAN_AUTH_ACCOUNT_REMOVED',
    actorId: 'system',
    actorRole: 'system',
    targetPersonId: null,
    subjectId: existing.uid,
    timestamp: Timestamp.now(),
    details: 'Auth account with no profile held an email being registered',
  });
  await adminAuth.createUser({ uid, email, password, displayName, emailVerified: false });
}

/**
 * Order matters: (1) reserve every identifier atomically with create() under a fresh
 * personId, (2) create the Auth user with that same uid, (3) write the person. Any failure
 * after (1) is compensated, so a taken username/email never leaves partial state and an
 * address can't be held hostage by an orphaned Auth account.
 */
export async function createPerson(
  input: CreatePersonInput,
  options: CreatePersonOptions
): Promise<CreatedPerson> {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw new PersonCreateError(
      400,
      'Username must be 3-30 characters: lowercase letters, numbers, dots, hyphens, or underscores.'
    );
  }
  const commEmailRaw = input.commEmail.trim();
  const commEmailKey = commEmailRaw.toLowerCase();
  if (!EMAIL_RE.test(commEmailRaw) || commEmailRaw.length > 254) {
    throw new PersonCreateError(400, 'A valid communication email is required.');
  }
  if (!input.password || input.password.length < 8) {
    throw new PersonCreateError(400, 'Password must be at least 8 characters.');
  }
  const photoDataUrl = validatePhoto(input.photoDataUrl);

  let ancestorIds: string[] = [];
  if (options.parentId) {
    const parent = await loadPerson(options.parentId);
    if (!parent) throw new PersonCreateError(400, 'Parent not found.');
    ancestorIds = computeAncestorIds(parent);
  }

  const edcDomain = process.env.EDC_EMAIL_DOMAIN?.trim();
  const edcEmail = edcDomain ? `${username}@${edcDomain}`.toLowerCase() : null;
  const identifierKeys = new Map<string, 'username' | 'commEmail' | 'edcEmail'>([
    [username, 'username'],
    [commEmailKey, 'commEmail'],
  ]);
  if (edcEmail && !identifierKeys.has(edcEmail)) identifierKeys.set(edcEmail, 'edcEmail');

  // (1) Reserve.
  const personId = adminDb.collection('people').doc().id;
  const now = Timestamp.now();
  const reserve = adminDb.batch();
  for (const [key, kind] of identifierKeys) {
    reserve.create(adminDb.collection('identifiers').doc(key), { personId, kind, createdAt: now });
  }
  try {
    await reserve.commit();
  } catch (err) {
    if (!isAlreadyExistsError(err)) throw err;
    const taken = await adminDb.collection('identifiers').doc(username).get();
    throw new PersonCreateError(409, taken.exists ? 'That username is already taken.' : 'That email is already registered.');
  }

  let authCreated = false;
  let accessNumber: string | null = null;
  try {
    // (2) Auth account, same uid.
    await createAuthUser(personId, commEmailRaw, input.password, `${input.firstName} ${input.lastName}`.trim());
    authCreated = true;
    const systemRole: SystemRole = options.systemRole ?? 'member';
    await adminAuth.setCustomUserClaims(personId, { systemRole });
    // Fingerprint only (lib/auth/passwordHashes.ts) — lets a later reset refuse the same password.
    await writeHashes(personId, { current: await hashPassword(input.password) });

    // (3) The person.
    const isApproved = options.registrationStatus === 'APPROVED';
    if (isApproved && input.profileType) accessNumber = await issueAccessNumber(personId);
    await adminDb.collection('people').doc(personId).create({
      personId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      username,
      commEmail: commEmailRaw,
      edcEmail,
      mobile: input.mobile.trim(),
      photoDataUrl,
      purpose: input.purpose.trim(),
      profileType: input.profileType,
      systemRole,
      parentId: options.parentId,
      ancestorIds,
      registrationStatus: options.registrationStatus,
      registrationDecision: isApproved ? { by: options.createdBy, at: now, note: null } : null,
      accessNumber,
      credentialVersion: 1,
      active: isApproved,
      createdAt: now,
      createdBy: options.createdBy,
      ...(options.event ? { eventId: options.event.eventId, eventName: options.event.eventName, registrationSource: options.event.source } : {}),
    });

    return { personId, username, commEmail: commEmailRaw, accessNumber, accessCode: accessCodeFor(input.profileType, accessNumber) };
  } catch (err) {
    // Compensate everything (1)–(3) may have left behind.
    if (authCreated) await adminAuth.deleteUser(personId).catch(() => {});
    if (accessNumber) await adminDb.collection('accessNumbers').doc(accessNumber).delete().catch(() => {});
    await Promise.all([...identifierKeys.keys()].map((k) => adminDb.collection('identifiers').doc(k).delete().catch(() => {})));
    throw err;
  }
}
