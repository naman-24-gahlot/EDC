// SERVER-ONLY. One-way fingerprints of passwords, so "the new password must differ from the old
// one" can be checked without ever storing a password. Firebase Auth keeps the real (hashed)
// password; this only answers "is this the same password as before?".
//
// passwordHashes/{personId}: { current, previous, oneTime, updatedAt } — each "scrypt$salt$hash"
// or null. Server-only (firestore.rules denies all client access). `current` is learned whenever
// we see the password in plain form anyway: registration, creation, sign-in, change.
if (typeof window !== 'undefined') {
  throw new Error('lib/auth/passwordHashes.ts must never be imported into client code.');
}

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
const KEY_LEN = 32;

export interface PasswordHashes { current: string | null; previous: string | null; oneTime: string | null }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function matches(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), KEY_LEN);
  const expected = Buffer.from(hash, 'base64url');
  return expected.length === key.length && timingSafeEqual(expected, key);
}

const ref = (personId: string) => adminDb.collection('passwordHashes').doc(personId);

export async function readHashes(personId: string): Promise<PasswordHashes> {
  const d = (await ref(personId).get()).data();
  return { current: d?.current ?? null, previous: d?.previous ?? null, oneTime: d?.oneTime ?? null };
}

export async function writeHashes(personId: string, patch: Partial<PasswordHashes>): Promise<void> {
  await ref(personId).set({ ...patch, updatedAt: Timestamp.now() }, { merge: true });
}

/** After a successful sign-in: remember the password's fingerprint if we don't have it yet. */
export async function learnCurrent(personId: string, password: string): Promise<void> {
  const h = await readHashes(personId);
  if (h.oneTime && (await matches(password, h.oneTime))) return; // signed in with the one-time password
  if (await matches(password, h.current)) return;
  await writeHashes(personId, { current: await hashPassword(password) });
}
