// SERVER-ONLY. Employee leave — DATABASE_SCHEMA.md "leaveRequests".
//   PENDING → APPROVED | REJECTED   (by Master, or anyone the employee is under — assertCanActOn)
//   PENDING | APPROVED → CANCELLED  (by the employee, until the leave has ended)
// Leave doesn't lock anyone out: the gate still lets an employee on leave in, and shows the guard
// "On approved leave". Never deleted; every transition has its audit entry.
if (typeof window !== 'undefined') {
  throw new Error('lib/leave.ts must never be imported into client code.');
}

import { after } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, loadPerson } from '@/lib/hierarchy/authorize';
import { formatDate } from '@/lib/display';
import { audit } from '@/lib/audit';
import { notifyLeaveDecided } from '@/lib/notify';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export interface LeaveRequest {
  id: string;
  personId: string;
  personName: string;
  /** Copied from the person, so "leave of people under me" is one query. */
  ancestorIds: string[];
  startDate: string;
  endDate: string;
  reason: string;
  status: LeaveStatus;
  createdAt: Timestamp;
  decidedBy: string | null;
  decidedAt: Timestamp | null;
  decisionNote: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 60;
const col = () => adminDb.collection('leaveRequests');
const toLeave = (d: FirebaseFirestore.DocumentSnapshot) => ({ ...(d.data() as Omit<LeaveRequest, 'id'>), id: d.id });
export const leaveRange = (l: Pick<LeaveRequest, 'startDate' | 'endDate'>) => (l.startDate === l.endDate ? formatDate(l.startDate) : `${formatDate(l.startDate)} → ${formatDate(l.endDate)}`);

export function parseLeaveInput(body: unknown) {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const startDate = typeof raw.startDate === 'string' ? raw.startDate : '';
  const endDate = typeof raw.endDate === 'string' && raw.endDate ? raw.endDate : startDate;
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) throw new HttpError(400, 'Pick the first and last day of your leave.');
  if (endDate < startDate) throw new HttpError(400, 'The last day can’t be before the first.');
  if (startDate < todayDateString()) throw new HttpError(400, 'Leave can’t start in the past.');
  if (endDate > addDays(startDate, MAX_DAYS - 1)) throw new HttpError(400, `Ask for at most ${MAX_DAYS} days at a time.`);
  if (!reason || reason.length > 200) throw new HttpError(400, 'Give a short reason (up to 200 characters).');
  return { startDate, endDate, reason };
}

export async function requestLeave(actor: SessionUser, input: { startDate: string; endDate: string; reason: string }) {
  const me = await loadPerson(actor.personId);
  if (!me || me.profileType !== 'employee' || me.registrationStatus !== 'APPROVED' || me.active !== true) {
    throw new HttpError(403, 'Leave is for approved employees.');
  }
  const mine = await listMyLeave(actor.personId);
  if (mine.some((l) => (l.status === 'PENDING' || l.status === 'APPROVED') && l.startDate <= input.endDate && input.startDate <= l.endDate)) {
    throw new HttpError(409, 'You already have leave asked for or approved on some of those days.');
  }
  const ref = col().doc();
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.create(ref, {
    personId: me.personId, personName: `${me.firstName} ${me.lastName}`, ancestorIds: me.ancestorIds, ...input,
    status: 'PENDING', createdAt: now, decidedBy: null, decidedAt: null, decisionNote: null,
  });
  audit(batch, { action: 'LEAVE_REQUESTED', actor, targetPersonId: me.personId, subjectId: ref.id, at: now, details: `${leaveRange(input)}: ${input.reason}` });
  await batch.commit();
  return { id: ref.id, status: 'PENDING' as const };
}

async function load(id: string) {
  if (!/^[A-Za-z0-9]{1,128}$/.test(id)) throw new HttpError(404, 'Leave request not found.');
  const snap = await col().doc(id).get();
  if (!snap.exists) throw new HttpError(404, 'Leave request not found.');
  return toLeave(snap);
}

export async function decideLeave(actor: SessionUser, id: string, approve: boolean, note: string | null) {
  const leave = await load(id);
  if (leave.personId === actor.personId) throw new HttpError(403, 'You can’t decide your own leave.');
  await assertCanActOn(actor, leave.personId);
  const ref = col().doc(id);
  await adminDb.runTransaction(async (tx) => {
    const fresh = toLeave(await tx.get(ref));
    if (fresh.status !== 'PENDING') throw new HttpError(409, `This leave request is already ${fresh.status.toLowerCase()}.`);
    const now = Timestamp.now();
    tx.update(ref, { status: approve ? 'APPROVED' : 'REJECTED', decidedBy: actor.personId, decidedAt: now, decisionNote: note });
    audit(tx, { action: approve ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', actor, targetPersonId: leave.personId, subjectId: id, at: now, details: `${leaveRange(leave)}${note ? `; ${note}` : ''}` });
  });
  after(() => notifyLeaveDecided(leave.personId, approve, leaveRange(leave), note).then(() => {}, (e) => console.error('Leave email failed', e)));
  return { id, status: approve ? 'APPROVED' : 'REJECTED' };
}

export async function cancelLeave(actor: SessionUser, id: string) {
  const leave = await load(id);
  if (leave.personId !== actor.personId) throw new HttpError(403, 'Only the employee can cancel their leave.');
  const ref = col().doc(id);
  await adminDb.runTransaction(async (tx) => {
    const fresh = toLeave(await tx.get(ref));
    if (fresh.status !== 'PENDING' && fresh.status !== 'APPROVED') throw new HttpError(409, `This leave request is already ${fresh.status.toLowerCase()}.`);
    if (fresh.endDate < todayDateString()) throw new HttpError(409, 'This leave has already ended.');
    const now = Timestamp.now();
    tx.update(ref, { status: 'CANCELLED', decidedAt: now });
    audit(tx, { action: 'LEAVE_CANCELLED', actor, targetPersonId: leave.personId, subjectId: id, at: now, details: `${leaveRange(leave)} (was ${fresh.status.toLowerCase()})` });
  });
  return { id, status: 'CANCELLED' as const };
}

export async function listMyLeave(personId: string): Promise<LeaveRequest[]> {
  const snap = await col().where('personId', '==', personId).get();
  return snap.docs.map(toLeave).sort((a, b) => b.startDate.localeCompare(a.startDate));
}

/** Master: everyone's (latest 200). Anyone else: the people under them. Newest first. */
export async function listLeaveFor(actor: SessionUser): Promise<LeaveRequest[]> {
  const q = actor.systemRole === 'master'
    ? col().orderBy('createdAt', 'desc').limit(200)
    : col().where('ancestorIds', 'array-contains', actor.personId).limit(200);
  return (await q.get()).docs.map(toLeave).sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
}

/** Approved leave covering `date`, if any — shown to the guard, never a reason to refuse. */
export async function leaveOn(personId: string, date: string): Promise<LeaveRequest | null> {
  const snap = await col().where('personId', '==', personId).where('status', '==', 'APPROVED').get();
  return snap.docs.map(toLeave).find((l) => l.startDate <= date && date <= l.endDate) ?? null;
}
