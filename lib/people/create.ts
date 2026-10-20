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

export const PersonCreateError = HttpError;

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const MAX_PHOTO_BYTES = 150 * 1024;
const PHOTO_DATA_URL_RE = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/;

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 6) return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('ALREADY_EXISTS');
}

function validatePhoto(photoDataUrl: string | null): string | null {
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
  profileType: ProfileType | null; // null only for guards (created in a later phase)
  password: string;
  photoDataUrl: string | null;
}

export interface CreatePersonOptions {
  createdBy: string; // personId, or 'self' for public registration
  parentId: string | null;
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
 * Creates the Firebase Auth account, then the people/identifiers(+accessNumbers)
 * Firestore docs. If the Firestore side fails after the Auth account was created
 * (most likely: a rare race on username/email past the pre-check below), the Auth
 * account is deleted so the email isn't left permanently locked to an orphaned
 * account with no profile.
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
  if (!commEmailKey.includes('@')) {
    throw new PersonCreateError(400, 'A valid communication email is required.');
  }
  if (!input.password || input.password.length < 8) {
    throw new PersonCreateError(400, 'Password must be at least 8 characters.');
  }
  const photoDataUrl = validatePhoto(input.photoDataUrl);

  // Pre-check — not the source of truth (the batch's create() below is), but avoids
  // creating-then-deleting an Auth account in the common non-racing case.
  const [usernameSnap, emailSnap] = await Promise.all([
    adminDb.collection('identifiers').doc(username).get(),
    adminDb.collection('identifiers').doc(commEmailKey).get(),
  ]);
  if (usernameSnap.exists) throw new PersonCreateError(409, 'That username is already taken.');
  if (emailSnap.exists) throw new PersonCreateError(409, 'That email is already registered.');

  let ancestorIds: string[] = [];
  if (options.parentId) {
    const parent = await loadPerson(options.parentId);
    if (!parent) throw new PersonCreateError(400, 'Parent not found.');
    ancestorIds = computeAncestorIds(parent);
  }

  const displayName = `${input.firstName} ${input.lastName}`.trim();
  let personId: string;
  try {
    const created = await adminAuth.createUser({
      email: commEmailRaw,
      password: input.password,
      displayName,
      emailVerified: false,
    });
    personId = created.uid;
  } catch (err) {
    const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
    if (code === 'auth/email-already-exists') {
      throw new PersonCreateError(409, 'That email is already registered.');
    }
    throw err;
  }

  let accessNumber: string | null = null;
  try {
    const systemRole: SystemRole = options.systemRole ?? 'member';
    await adminAuth.setCustomUserClaims(personId, { systemRole });

    const now = Timestamp.now();
    const isApproved = options.registrationStatus === 'APPROVED';

    if (isApproved && input.profileType) {
      accessNumber = await issueAccessNumber(personId);
    }

    const edcDomain = process.env.EDC_EMAIL_DOMAIN?.trim();
    const edcEmail = edcDomain ? `${username}@${edcDomain}`.toLowerCase() : null;

    const batch = adminDb.batch();
    batch.create(adminDb.collection('people').doc(personId), {
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
    });
    batch.create(adminDb.collection('identifiers').doc(username), {
      personId,
      kind: 'username',
      createdAt: now,
    });
    batch.create(adminDb.collection('identifiers').doc(commEmailKey), {
      personId,
      kind: 'commEmail',
      createdAt: now,
    });
    if (edcEmail && edcEmail !== commEmailKey) {
      batch.create(adminDb.collection('identifiers').doc(edcEmail), {
        personId,
        kind: 'edcEmail',
        createdAt: now,
      });
    }

    await batch.commit();

    return {
      personId,
      username,
      commEmail: commEmailRaw,
      accessNumber,
      accessCode: accessCodeFor(input.profileType, accessNumber),
    };
  } catch (err) {
    // Compensate: don't leave an orphaned Auth account holding this email hostage.
    await adminAuth.deleteUser(personId).catch(() => {});
    if (accessNumber) {
      await adminDb.collection('accessNumbers').doc(accessNumber).delete().catch(() => {});
    }
    if (isAlreadyExistsError(err)) {
      throw new PersonCreateError(409, 'That username or email was just taken — please try again.');
    }
    throw err;
  }
}
