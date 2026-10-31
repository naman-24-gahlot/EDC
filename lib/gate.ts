// SERVER-ONLY. Who is on campus right now: everyone whose last gate scan was an entry
// (`people.onCampus`, set by IN scans and cleared by OUT scans) — including anyone who came in
// on an earlier day, so overnight stays and forgotten exit scans stay visible. Grouped for the
// headcount. The stay fields written at entry (lib/stays.ts) make the warnings readable from the
// person alone; the guard screen shows only the counts (onCampusSummary) until the list is asked for.
if (typeof window !== 'undefined') {
  throw new Error('lib/gate.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { nowInIST } from '@/lib/date';
import { siteOrigin } from '@/lib/origin';
import { PROFILE_LABEL } from '@/lib/display';
import type { ProfileType } from '@/lib/access/codes';
import { currentEntitlementsFor } from '@/lib/access/entitlements';
import { stayFieldsAtEntry, sweepOvernight } from '@/lib/stays';
import { personTouched } from '@/lib/people/peopleIndex';

export interface OnCampus {
  personId: string;
  name: string;
  /** Headcount group: profile label, the event for event guests, or Master / Guard. */
  group: string;
  vvip: boolean;
  since: string; // ISO
  /** Came in on an earlier day and still recorded inside. */
  overnight: boolean;
  /** Still inside more than the grace period after their gate-closing time today. */
  afterHours: boolean;
  allowedOvernight: boolean;
}

const PANEL_FIELDS = ['firstName', 'lastName', 'profileType', 'systemRole', 'eventId', 'eventName', 'lastEntryAt', 'vvip', 'stayAlertAt', 'overnightOk'] as const;

/** Everyone inside (one read each), grouped. Also runs the overnight check. */
export async function onCampusNow(): Promise<OnCampus[]> {
  const snap = await adminDb.collection('people').where('onCampus', '==', true).select(...PANEL_FIELDS).get();
  // Inside since before the stay fields existed: work them out once from the access record and store them.
  const legacy = snap.docs.filter((d) => !(d.data().stayAlertAt instanceof Timestamp));
  const filled = new Map<string, { stayAlertAt: Timestamp; overnightOk: boolean }>();
  if (legacy.length > 0) {
    const ents = await currentEntitlementsFor(legacy.map((d) => d.id));
    const batch = adminDb.batch();
    for (const d of legacy) {
      const entryAt = d.data().lastEntryAt as Timestamp;
      const fields = stayFieldsAtEntry(ents.get(d.id) ?? null, entryAt);
      filled.set(d.id, { stayAlertAt: fields.stayAlertAt, overnightOk: fields.overnightOk });
      batch.update(d.ref, { ...fields, ...personTouched() }, { lastUpdateTime: d.updateTime });
    }
    await batch.commit().catch((e) => console.error('Stay fields backfill failed', e));
  }
  sweepOvernight(await siteOrigin());
  const now = nowInIST();
  const nowMs = Date.now();
  return snap.docs.map((d) => {
    const p = d.data() as { firstName: string; lastName: string; profileType: ProfileType | null; systemRole?: string; eventName?: string; eventId?: string; lastEntryAt: Timestamp; vvip?: boolean; stayAlertAt?: Timestamp; overnightOk?: boolean };
    const stay = filled.get(d.id) ?? { stayAlertAt: p.stayAlertAt!, overnightOk: p.overnightOk === true };
    const overnight = nowInIST(p.lastEntryAt.toDate()).date < now.date;
    const afterHours = !overnight && !stay.overnightOk && stay.stayAlertAt.toMillis() <= nowMs;
    const group = p.systemRole === 'master' ? 'Masters' : p.systemRole === 'guard' ? 'Guards'
      : p.profileType === 'event_guest' && p.eventName ? `Event: ${p.eventName}` : p.profileType ? PROFILE_LABEL[p.profileType] : 'Other';
    return { personId: d.id, name: `${p.firstName} ${p.lastName}`, group, vvip: p.vvip === true, since: p.lastEntryAt.toDate().toISOString(), overnight, afterHours, allowedOvernight: stay.overnightOk };
  }).sort((a, b) => a.group.localeCompare(b.group) || b.since.localeCompare(a.since));
}

/**
 * The guard screen's headline without reading anyone: how many are inside, and how many of them
 * are past their hours or inside since an earlier day (stayAlertAt passed). Two counts, plus the
 * overnight check (usually one read).
 */
export async function onCampusSummary(): Promise<{ count: number; warnings: number }> {
  const people = adminDb.collection('people');
  const [count, warnings] = await Promise.all([
    people.where('onCampus', '==', true).count().get(),
    people.where('stayAlertAt', '<=', Timestamp.now()).count().get(),
  ]);
  sweepOvernight(await siteOrigin());
  return { count: count.data().count, warnings: warnings.data().count };
}
