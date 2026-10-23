// SERVER-ONLY. Who is on campus right now: entered today (IST) and not recorded leaving since.
if (typeof window !== 'undefined') {
  throw new Error('lib/gate.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { todayDateString } from '@/lib/date';

export interface OnCampus { personId: string; name: string; profileType: string | null; eventName: string | null; since: Date }

export async function onCampusNow(): Promise<OnCampus[]> {
  const startOfDay = Timestamp.fromDate(new Date(`${todayDateString()}T00:00:00+05:30`));
  const snap = await adminDb.collection('people').where('lastEntryAt', '>=', startOfDay)
    .select('firstName', 'lastName', 'profileType', 'eventName', 'lastEntryAt', 'lastExitAt').get();
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as { firstName: string; lastName: string; profileType: string | null; eventName?: string; lastEntryAt: Timestamp; lastExitAt?: Timestamp }) }))
    .filter((p) => (p.lastExitAt?.toMillis() ?? 0) < p.lastEntryAt.toMillis())
    .map((p) => ({ personId: p.id, name: `${p.firstName} ${p.lastName}`, profileType: p.profileType, eventName: p.eventName ?? null, since: p.lastEntryAt.toDate() }))
    .sort((a, b) => b.since.getTime() - a.since.getTime());
}
