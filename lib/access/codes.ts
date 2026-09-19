// SERVER-ONLY. Access-code prefixes and issuance. See DATABASE_SCHEMA.md
// "accessNumbers" and SECURITY_MODEL.md "Access credential" — the code is a lookup
// key, not a secret, and is always derived (PREFIX + accessNumber), never stored as
// a single combined string.
if (typeof window !== 'undefined') {
  throw new Error('lib/access/codes.ts must never be imported into client code.');
}

import { randomInt } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

export type ProfileType =
  | 'employee'
  | 'incubee'
  | 'event_guest'
  | 'driver'
  | 'relative'
  | 'bodyguard';

export const PROFILE_TYPES: readonly ProfileType[] = [
  'employee',
  'incubee',
  'event_guest',
  'driver',
  'relative',
  'bodyguard',
] as const;

export function isProfileType(value: unknown): value is ProfileType {
  return typeof value === 'string' && (PROFILE_TYPES as readonly string[]).includes(value);
}

export const PREFIX: Record<ProfileType, string> = {
  employee: 'EDC',
  incubee: 'INC',
  event_guest: 'GUE',
  driver: 'DRV',
  relative: 'REL',
  bodyguard: 'BDG',
};

/** Only employees (and Master) may be a parent — see DATABASE_SCHEMA.md "Hierarchy rules". */
export const PARENT_CAPABLE_PROFILE_TYPES: readonly ProfileType[] = ['employee'];

/** What an Employee/Master may create directly as an already-approved subordinate. */
export const SUBORDINATE_PROFILE_TYPES: readonly ProfileType[] = [
  'driver',
  'relative',
  'bodyguard',
  'event_guest',
];

const MIN_NUMBER = 10000;
const MAX_NUMBER = 99999; // inclusive
const MAX_ATTEMPTS = 20;

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 6) return true; // gRPC ALREADY_EXISTS
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('ALREADY_EXISTS');
}

/**
 * Atomically reserves a random unique 5-digit access number for `personId` by racing
 * create() on accessNumbers/{digits} — retried on collision. This is its own atomic
 * step (not part of a caller's batch): accessNumber is only ever issued once a
 * person's creation/approval is otherwise guaranteed to succeed, so the tiny window
 * where this could succeed while a separate subsequent write fails is an accepted,
 * documented tradeoff (see lib/people/create.ts).
 */
export async function issueAccessNumber(personId: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = String(randomInt(MIN_NUMBER, MAX_NUMBER + 1));
    const ref = adminDb.collection('accessNumbers').doc(candidate);
    try {
      await ref.create({ personId, issuedAt: Timestamp.now() });
      return candidate;
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;
      // else: collision — try another candidate
    }
  }
  throw new Error('Could not allocate a unique access number after multiple attempts');
}

export function accessCodeFor(
  profileType: ProfileType | null | undefined,
  accessNumber: string | null | undefined
): string | null {
  if (!profileType || !accessNumber) return null;
  return PREFIX[profileType] + accessNumber;
}
