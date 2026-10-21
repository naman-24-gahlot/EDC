// SERVER-ONLY. Master-scope reads for the admin pages (the layout already guarantees Master).
if (typeof window !== 'undefined') {
  throw new Error('app/admin/data.ts must never be imported into client code.');
}

import { adminDb } from '@/lib/firebase/admin';
import { requirePageRole, type SessionUser } from '@/lib/session';
import { toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';

/**
 * Every admin PAGE must call this first. The layout's check is not enough: on client-side
 * navigation Next renders only the changed page segment and skips layouts the browser claims
 * to have, so a crafted request could otherwise get a page's data without the layout running.
 */
export function requireMasterPage(): Promise<SessionUser> {
  return requirePageRole('master');
}

export async function allPeople(): Promise<PersonRecord[]> {
  return (await adminDb.collection('people').get()).docs.map((d) => toPerson(d)!);
}

/** Nav badges: actionable PENDING requests (past-deadline ones excluded) and PENDING registrations. */
export async function pendingCounts(): Promise<{ requests: number; registrations: number }> {
  const nowMs = Date.now();
  const [pendingRequests, pendingRegistrations] = await Promise.all([
    adminDb.collection('accessRequests').where('status', '==', 'PENDING').select('actionableUntil').get(),
    adminDb.collection('people').where('registrationStatus', '==', 'PENDING').count().get(),
  ]);
  return {
    requests: pendingRequests.docs.filter((d) => (d.data().actionableUntil?.toMillis?.() ?? 0) > nowMs).length,
    registrations: pendingRegistrations.data().count,
  };
}

/** Display names for just these ids — one batched read of three fields each, not the whole table. */
export async function namesFor(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^[A-Za-z0-9]{1,128}$/.test(x)))];
  if (unique.length === 0) return new Map();
  const snaps = await adminDb.getAll(...unique.map((id) => adminDb.collection('people').doc(id)), { fieldMask: ['firstName', 'lastName'] });
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, `${s.data()!.firstName} ${s.data()!.lastName}`]));
}

export function nameMap(people: PersonRecord[]): Map<string, string> {
  return new Map(people.map((p) => [p.personId, `${p.firstName} ${p.lastName}`]));
}

