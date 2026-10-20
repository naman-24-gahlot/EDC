// SERVER-ONLY. The hierarchical authorization primitive. See SECURITY_MODEL.md
// "Hierarchical authorization" — every route that acts on another person goes through here.
if (typeof window !== 'undefined') {
  throw new Error('lib/hierarchy/authorize.ts must never be imported into client code.');
}

import { NextResponse } from 'next/server';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import type { SystemRole } from '@/lib/roles';
import type { ProfileType } from '@/lib/access/codes';

/** ancestorIds.length may not exceed this (root→parent chain). */
export const MAX_DEPTH = 5;

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Route helper: turns an HttpError into its JSON response; anything else is a logged 500. */
export function errorResponse(err: unknown, fallback = 'Something went wrong.'): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(fallback, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export interface PersonRecord {
  personId: string;
  firstName: string;
  lastName: string;
  username: string;
  profileType: ProfileType | null;
  systemRole: SystemRole;
  parentId: string | null;
  ancestorIds: string[];
  registrationStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  accessNumber: string | null;
  credentialVersion: number;
  active: boolean;
  [field: string]: unknown;
}

export function toPerson(snap: DocumentSnapshot): PersonRecord | null {
  if (!snap.exists) return null;
  const data = snap.data()!;
  return { ...data, personId: snap.id, ancestorIds: (data.ancestorIds as string[]) ?? [] } as PersonRecord;
}

export async function loadPerson(personId: string): Promise<PersonRecord | null> {
  if (!personId || personId.includes('/')) return null;
  return toPerson(await adminDb.collection('people').doc(personId).get());
}

/** The ancestor chain a child of `parent` gets. Throws 400 if it would exceed MAX_DEPTH. */
export function computeAncestorIds(parent: Pick<PersonRecord, 'personId' | 'ancestorIds'> | null): string[] {
  if (!parent) return [];
  const ancestorIds = [...parent.ancestorIds, parent.personId];
  if (ancestorIds.length > MAX_DEPTH) {
    throw new HttpError(400, `Hierarchy depth is capped at ${MAX_DEPTH}.`);
  }
  return ancestorIds;
}

export function requireMaster(actor: SessionUser): void {
  if (actor.systemRole !== 'master') throw new HttpError(403, 'Master only.');
}

/**
 * Passes iff the actor is Master, or the actor's personId is in the target's ancestorIds
 * (and the actor's own profile is approved + active). Returns the loaded target.
 * Non-masters get 403 for a missing target too, so ids can't be probed for existence.
 */
export async function assertCanActOn(actor: SessionUser, targetPersonId: string): Promise<PersonRecord> {
  const target = await loadPerson(targetPersonId);

  if (actor.systemRole === 'master') {
    if (!target) throw new HttpError(404, 'Person not found.');
    return target;
  }

  const denied = new HttpError(403, 'Not authorized to act on this person.');
  if (!target || !target.ancestorIds.includes(actor.personId)) throw denied;

  const self = await loadPerson(actor.personId);
  if (!self || self.registrationStatus !== 'APPROVED' || self.active !== true) throw denied;

  return target;
}

/** Everyone below personId, at any depth — a server-side array-contains query. */
export async function listDescendants(personId: string): Promise<PersonRecord[]> {
  const snap = await adminDb.collection('people').where('ancestorIds', 'array-contains', personId).get();
  return snap.docs.map((doc) => toPerson(doc)!);
}
