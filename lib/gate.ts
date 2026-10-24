// SERVER-ONLY. Who is on campus right now: everyone whose last gate scan was an entry
// (`people.onCampus`, set by IN scans and cleared by OUT scans) — including anyone who came in
// on an earlier day, so overnight stays and forgotten exit scans stay visible. Grouped for the
// headcount; loading it also flags overnight stays (lib/stays.ts).
if (typeof window !== 'undefined') {
  throw new Error('lib/gate.ts must never be imported into client code.');
}

import type { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { nowInIST } from '@/lib/date';
import { siteOrigin } from '@/lib/origin';
import { PROFILE_LABEL } from '@/lib/display';
import type { ProfileType } from '@/lib/access/codes';
import { currentEntitlementsFor } from '@/lib/access/entitlements';
import { GRACE_MIN, sweepOvernight } from '@/lib/stays';

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

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export async function onCampusNow(): Promise<OnCampus[]> {
  const snap = await adminDb.collection('people').where('onCampus', '==', true)
    .select('firstName', 'lastName', 'profileType', 'systemRole', 'eventId', 'eventName', 'lastEntryAt', 'ancestorIds', 'vvip').get();
  const ents = await currentEntitlementsFor(snap.docs.map((d) => d.id));
  const now = nowInIST();
  const rows = snap.docs.map((d) => {
    const p = d.data() as { firstName: string; lastName: string; profileType: ProfileType | null; systemRole?: string; eventId?: string; eventName?: string; lastEntryAt: Timestamp; ancestorIds?: string[]; vvip?: boolean };
    const ent = ents.get(d.id);
    const allowedOvernight = ent?.allowOvernight === true;
    const overnight = nowInIST(p.lastEntryAt.toDate()).date < now.date;
    const afterHours = !overnight && !allowedOvernight && !!ent && minutes(now.time) - minutes(ent.endTime) > GRACE_MIN;
    const group = p.systemRole === 'master' ? 'Masters' : p.systemRole === 'guard' ? 'Guards'
      : p.profileType === 'event_guest' && p.eventName ? `Event: ${p.eventName}` : p.profileType ? PROFILE_LABEL[p.profileType] : 'Other';
    return {
      row: { personId: d.id, name: `${p.firstName} ${p.lastName}`, group, vvip: p.vvip === true, since: p.lastEntryAt.toDate().toISOString(), overnight, afterHours, allowedOvernight },
      sweep: { who: { personId: d.id, firstName: p.firstName, lastName: p.lastName, ancestorIds: p.ancestorIds ?? [], eventId: p.eventId }, entryAt: p.lastEntryAt, allowOvernight: allowedOvernight },
    };
  });
  sweepOvernight(rows.map((r) => r.sweep), await siteOrigin());
  return rows.map((r) => r.row).sort((a, b) => a.group.localeCompare(b.group) || b.since.localeCompare(a.since));
}
