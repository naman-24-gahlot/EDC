// SERVER-ONLY. Master-scope reads for the admin pages (the layout already guarantees Master).
if (typeof window !== 'undefined') {
  throw new Error('app/admin/data.ts must never be imported into client code.');
}

import { adminDb } from '@/lib/firebase/admin';
import { requirePageRole, type SessionUser } from '@/lib/session';
import { toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import type { Entitlement } from '@/lib/access/entitlements';

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

export function nameMap(people: PersonRecord[]): Map<string, string> {
  return new Map(people.map((p) => [p.personId, `${p.firstName} ${p.lastName}`]));
}

/** Current entitlement per person: the ACTIVE one, else the most recent. */
export async function currentEntitlementByPerson(): Promise<Map<string, Entitlement>> {
  const all = (await adminDb.collection('entitlements').get()).docs
    .map((d) => ({ ...(d.data() as Omit<Entitlement, 'id'>), id: d.id }))
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  const out = new Map<string, Entitlement>();
  for (const e of all) {
    const seen = out.get(e.personId);
    if (!seen || (seen.state !== 'ACTIVE' && e.state === 'ACTIVE')) out.set(e.personId, e);
  }
  return out;
}
