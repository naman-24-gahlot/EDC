// SERVER-ONLY. Master-scope reads for the admin pages (the layout already guarantees Master).
if (typeof window !== 'undefined') {
  throw new Error('app/admin/data.ts must never be imported into client code.');
}

import { adminDb } from '@/lib/firebase/admin';
import { toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import type { Entitlement } from '@/lib/access/entitlements';

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
