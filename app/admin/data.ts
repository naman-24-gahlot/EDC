// SERVER-ONLY. Master-scope reads for the admin pages (the layout already guarantees Master).
if (typeof window !== 'undefined') {
  throw new Error('app/admin/data.ts must never be imported into client code.');
}

import { adminDb } from '@/lib/firebase/admin';
import { requirePageRole, type SessionUser } from '@/lib/session';
import { LIST_FIELDS, toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';

/**
 * Every admin PAGE must call this first. The layout's check is not enough: on client-side
 * navigation Next renders only the changed page segment and skips layouts the browser claims
 * to have, so a crafted request could otherwise get a page's data without the layout running.
 */
export function requireMasterPage(): Promise<SessionUser> {
  return requirePageRole('master');
}

export async function allPeople(): Promise<PersonRecord[]> {
  return (await adminDb.collection('people').select(...LIST_FIELDS).get()).docs.map((d) => toPerson(d)!);
}

/** Nav badges: actionable PENDING requests (past-deadline ones excluded) and PENDING registrations. */
export async function pendingCounts(): Promise<{ requests: number; registrations: number; stays: number; leave: number }> {
  const nowMs = Date.now();
  const [pendingRequests, pendingRegistrations, unseenStays, pendingLeave] = await Promise.all([
    adminDb.collection('accessRequests').where('status', '==', 'PENDING').select('actionableUntil').get(),
    adminDb.collection('people').where('registrationStatus', '==', 'PENDING').count().get(),
    adminDb.collection('stayFlags').where('seenAt', '==', null).count().get(),
    adminDb.collection('leaveRequests').where('status', '==', 'PENDING').count().get(),
  ]);
  return {
    requests: pendingRequests.docs.filter((d) => (d.data().actionableUntil?.toMillis?.() ?? 0) > nowMs).length,
    registrations: pendingRegistrations.data().count,
    stays: unseenStays.data().count,
    leave: pendingLeave.data().count,
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


export { siteOrigin } from '@/lib/origin';

/** A Timestamp as "YYYY-MM-DDTHH:MM" in IST — what a datetime-local input holds. */
export function istInput(ts: { toMillis: () => number }): string {
  return new Date(ts.toMillis() + 330 * 60_000).toISOString().slice(0, 16);
}

/** Registration counts per status for these events (equality-only counts need no extra index). */
export async function eventCounts(eventIds: string[]): Promise<Map<string, Record<'PENDING' | 'APPROVED' | 'REJECTED', number>>> {
  const statuses = ['PENDING', 'APPROVED', 'REJECTED'] as const;
  const rows = await Promise.all(eventIds.map(async (id) => {
    const counts = await Promise.all(statuses.map((s) => adminDb.collection('people').where('eventId', '==', id).where('registrationStatus', '==', s).count().get()));
    return [id, Object.fromEntries(statuses.map((s, i) => [s, counts[i].data().count]))] as const;
  }));
  return new Map(rows as [string, Record<'PENDING' | 'APPROVED' | 'REJECTED', number>][]);
}
