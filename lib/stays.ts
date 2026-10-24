// SERVER-ONLY. Stay tracking — DATABASE_SCHEMA.md "stayFlags". From the gate's IN/OUT scans:
//   LATE_EXIT    left more than GRACE_MIN after their gate-closing time (same day)
//   OVERNIGHT    still recorded inside after midnight, or left on a later day
//   MISSED_EXIT  came in again, an hour or more after the last entry, with no exit scan between
// …unless their access says "may stay overnight". No cron: the gate checks at each scan, and
// "still inside since yesterday" is noticed whenever anyone loads "On campus now" (the guard
// screen does, all day). Each flag is written once (deterministic id + create()), with its audit
// entry; OVERNIGHT and MISSED_EXIT also email the person's immediate parent (or every Master
// for top-level people). Parents see their people's flags on /me, Masters all of them.
if (typeof window !== 'undefined') {
  throw new Error('lib/stays.ts must never be imported into client code.');
}

import { after } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { nowInIST } from '@/lib/date';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, type PersonRecord } from '@/lib/hierarchy/authorize';
import type { Entitlement } from '@/lib/access/entitlements';
import { audit, eventIdOf, type AuditAction } from '@/lib/audit';
import { notifyStayAlert } from '@/lib/notify';

export type StayKind = 'LATE_EXIT' | 'OVERNIGHT' | 'MISSED_EXIT';
export const GRACE_MIN = 15;
const MISSED_EXIT_AFTER_MIN = 60;
const ACTION: Record<StayKind, AuditAction> = { LATE_EXIT: 'LATE_EXIT', OVERNIGHT: 'OVERNIGHT_STAY', MISSED_EXIT: 'MISSED_EXIT_SCAN' };
export const STAY_LABEL: Record<StayKind, string> = { LATE_EXIT: 'Left late', OVERNIGHT: 'Overnight', MISSED_EXIT: 'No exit scan' };

export interface StayFlag {
  id: string;
  kind: StayKind;
  personId: string;
  personName: string;
  ancestorIds: string[];
  entryAt: Timestamp;
  exitAt: Timestamp | null;
  minutesLate: number | null;
  stayMinutes: number | null;
  detail: string;
  eventId: string | null;
  createdAt: Timestamp;
  seenBy: string | null;
  seenAt: Timestamp | null;
}

type Who = Pick<PersonRecord, 'personId' | 'firstName' | 'lastName' | 'ancestorIds'> & { eventId?: unknown };

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const istDate = (ts: Timestamp) => nowInIST(ts.toDate()).date;
const clock = (ts: Timestamp) => ts.toDate().toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
export const durationText = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

/** Writes the flag once; false if this visit already has one of this kind. */
async function raise(kind: StayKind, who: Who, entryAt: Timestamp, extra: { exitAt?: Timestamp | null; minutesLate?: number | null; stayMinutes?: number | null; detail: string }, origin: string | null) {
  const ref = adminDb.collection('stayFlags').doc(`${kind}_${who.personId}_${entryAt.toMillis()}`);
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.create(ref, {
    kind, personId: who.personId, personName: `${who.firstName} ${who.lastName}`, ancestorIds: who.ancestorIds ?? [],
    entryAt, exitAt: extra.exitAt ?? null, minutesLate: extra.minutesLate ?? null, stayMinutes: extra.stayMinutes ?? null,
    detail: extra.detail, eventId: eventIdOf(who), createdAt: now, seenBy: null, seenAt: null,
  });
  audit(batch, { action: ACTION[kind], actor: 'system', targetPersonId: who.personId, subjectId: ref.id, eventId: eventIdOf(who), at: now, details: extra.detail });
  try {
    await batch.commit();
  } catch (err) {
    if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS: flagged before
    throw err;
  }
  if (kind !== 'LATE_EXIT' && origin) await notifyStayAlert(who.personId, extra.detail, origin).catch((e) => console.error('Stay alert email failed', e));
  return true;
}

/**
 * At an OUT scan: how long they stayed, and whether that was late or overnight. At an IN scan
 * while still recorded inside: the previous visit had no exit scan. Runs after the gate has
 * answered (never slows or fails the gate).
 */
export function afterGateScan(person: PersonRecord, entitlement: Entitlement | null, direction: 'IN' | 'OUT', now: Timestamp, origin: string) {
  const entryAt = person.onCampus === true && person.lastEntryAt instanceof Timestamp ? person.lastEntryAt : null;
  if (!entryAt) return;
  after(async () => {
    try {
      if (direction === 'IN') {
        // A re-scan within the hour (a double scan, or the guard checking again) isn't a missed exit.
        if (now.toMillis() - entryAt.toMillis() < MISSED_EXIT_AFTER_MIN * 60_000) return;
        await raise('MISSED_EXIT', person, entryAt, { detail: `came in at ${clock(now)} without an exit scan since entering at ${clock(entryAt)}` }, origin);
        return;
      }
      if (entitlement?.allowOvernight) return;
      const stayMinutes = Math.round((now.toMillis() - entryAt.toMillis()) / 60_000);
      const out = nowInIST(now.toDate());
      if (out.date > istDate(entryAt)) {
        await raise('OVERNIGHT', person, entryAt, { exitAt: now, stayMinutes, detail: `stayed overnight: in ${clock(entryAt)}, out ${clock(now)} (${durationText(stayMinutes)})` }, origin);
      } else if (entitlement) {
        const late = minutes(out.time) - minutes(entitlement.endTime);
        if (late > GRACE_MIN) await raise('LATE_EXIT', person, entryAt, { exitAt: now, minutesLate: late, stayMinutes, detail: `left at ${out.time}, ${durationText(late)} after the gate closed (${entitlement.endTime})` }, origin);
      }
    } catch (err) {
      console.error('Stay check failed', err);
    }
  });
}

/** Minutes between their last entry and now, for the OUT scan's record. */
export function stayMinutesAt(person: PersonRecord, now: Timestamp): number | null {
  return person.onCampus === true && person.lastEntryAt instanceof Timestamp ? Math.round((now.toMillis() - person.lastEntryAt.toMillis()) / 60_000) : null;
}

/** Still recorded inside since before today (and not allowed overnight) → flagged once. */
export function sweepOvernight(rows: { who: Who; entryAt: Timestamp; allowOvernight: boolean }[], origin: string) {
  const today = nowInIST().date;
  const due = rows.filter((r) => !r.allowOvernight && istDate(r.entryAt) < today);
  if (due.length === 0) return;
  after(async () => {
    for (const r of due) {
      await raise('OVERNIGHT', r.who, r.entryAt, { detail: `has been recorded inside since ${clock(r.entryAt)} — stayed overnight or left without an exit scan` }, origin)
        .catch((e) => console.error('Overnight flag failed', e));
    }
  });
}

const toFlag = (d: FirebaseFirestore.DocumentSnapshot) => ({ ...(d.data() as Omit<StayFlag, 'id'>), id: d.id });

/** Masters: the latest flags. Anyone else: flags about people under them (ancestorIds). */
export async function listFlags(actor: SessionUser, limit = 100): Promise<StayFlag[]> {
  const q = actor.systemRole === 'master'
    ? adminDb.collection('stayFlags').orderBy('createdAt', 'desc').limit(limit)
    : adminDb.collection('stayFlags').where('ancestorIds', 'array-contains', actor.personId).limit(limit);
  const snap = await q.get();
  return snap.docs.map(toFlag).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

/** "Seen" — by Master or anyone above the person (same rule as acting on them). */
export async function markFlagSeen(actor: SessionUser, flagId: string) {
  if (!/^[A-Z_]+_[A-Za-z0-9]+_\d+$/.test(flagId)) throw new HttpError(404, 'Not found.');
  const ref = adminDb.collection('stayFlags').doc(flagId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpError(actor.systemRole === 'master' ? 404 : 403, actor.systemRole === 'master' ? 'Not found.' : 'Not authorized to act on this person.');
  const flag = toFlag(snap);
  await assertCanActOn(actor, flag.personId);
  if (flag.seenAt) return { id: flagId, seen: true };
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.update(ref, { seenBy: actor.personId, seenAt: now });
  audit(batch, { action: 'STAY_FLAG_SEEN', actor, targetPersonId: flag.personId, subjectId: flagId, eventId: flag.eventId, at: now, details: `${STAY_LABEL[flag.kind]}: ${flag.detail}` });
  await batch.commit();
  return { id: flagId, seen: true };
}
