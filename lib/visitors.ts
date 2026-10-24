// SERVER-ONLY. Visitor passes — the lite way in for a one- or two-day guest (DATABASE_SCHEMA.md
// "Visitors"). An approved employee or a Master fills in a name and mobile, picks the day(s) and
// hours, optionally marks them VVIP; the visitor is created already approved, with a VIS access
// code and an access period, and NO sign-in account (`hasAccount: false`). Their pass is a link
// (/v/<credential>) — the same HMAC credential the gate already checks, so nothing about
// verification changes; it stops working when the access ends, is revoked or the pass is reissued.
if (typeof window !== 'undefined') {
  throw new Error('lib/visitors.ts must never be imported into client code.');
}

import { after } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { addDays, todayDateString } from '@/lib/date';
import type { SessionUser } from '@/lib/session';
import { HttpError, loadPerson } from '@/lib/hierarchy/authorize';
import { accessCodeFor, issueAccessNumber } from '@/lib/access/codes';
import { passTokenFor } from '@/lib/access/credential';
import type { EntitlementWindow } from '@/lib/access/entitlements';
import { windowSummary } from '@/lib/display';
import { checkMobile } from '@/lib/phone';
import { audit } from '@/lib/audit';
import { notifyVisitorPass } from '@/lib/notify';

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_VISIT_DAYS = 2;
const MAX_DAYS_AHEAD = 60;

export interface VisitorInput {
  firstName: string; lastName: string; mobile: string; email: string | null; purpose: string;
  vvip: boolean; startDate: string; days: number; startTime: string; endTime: string;
}

export function parseVisitorInput(body: unknown): VisitorInput {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string).trim() : '');
  const firstName = str('firstName'), lastName = str('lastName');
  if (!NAME_RE.test(firstName) || !NAME_RE.test(lastName)) throw new HttpError(400, 'Enter the visitor’s first and last name.');
  const m = checkMobile(str('mobile'));
  if (!m.ok) throw new HttpError(400, m.message ?? 'Enter a valid mobile number.');
  const email = str('email').toLowerCase() || null;
  if (email && (!EMAIL_RE.test(email) || email.length > 254)) throw new HttpError(400, 'Enter a valid email, or leave it empty.');
  const purpose = str('purpose');
  if (!purpose || purpose.length > 200) throw new HttpError(400, 'Say what the visit is for (up to 200 characters).');
  const today = todayDateString();
  const startDate = str('startDate') || today;
  if (!DATE_RE.test(startDate) || startDate < today || startDate > addDays(today, MAX_DAYS_AHEAD)) throw new HttpError(400, `The visit must start between today and ${MAX_DAYS_AHEAD} days from now.`);
  const days = Number(raw.days ?? 1);
  if (!Number.isInteger(days) || days < 1 || days > MAX_VISIT_DAYS) throw new HttpError(400, `A visitor pass covers 1 or ${MAX_VISIT_DAYS} days — register them for longer visits.`);
  const startTime = str('startTime') || '09:00', endTime = str('endTime') || '18:00';
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime) || startTime >= endTime) throw new HttpError(400, 'Pick hours where the start is before the end.');
  return { firstName, lastName, mobile: m.value!, email, purpose, vvip: raw.vvip === true, startDate, days, startTime, endTime };
}

/** The pass link for a visitor (the link carries their gate credential). */
export const visitorPassUrl = (origin: string, p: { personId: string; credentialVersion: number }) => `${origin}/v/${encodeURIComponent(passTokenFor(p))}`;

export async function createVisitor(actor: SessionUser, input: VisitorInput, origin: string) {
  const host = await loadPerson(actor.personId);
  const isMaster = actor.systemRole === 'master';
  if (!host || (!isMaster && (host.profileType !== 'employee' || host.registrationStatus !== 'APPROVED' || host.active !== true))) {
    throw new HttpError(403, 'Only an active employee or a Master can create a visitor pass.');
  }
  // Hierarchy as for any dependant: under the employee who invited them (a Master who isn't an
  // employee leaves them top-level — Masters can act on everyone anyway).
  const underHost = host.profileType === 'employee';
  const parentId = underHost ? host.personId : null;
  const ancestorIds = underHost ? [...host.ancestorIds, host.personId] : [];

  const personId = adminDb.collection('people').doc().id;
  const accessNumber = await issueAccessNumber(personId);
  const username = `visitor-${accessNumber}`;
  const window: EntitlementWindow = { startDate: input.startDate, endDate: addDays(input.startDate, input.days - 1), weekdays: [0, 1, 2, 3, 4, 5, 6], startTime: input.startTime, endTime: input.endTime, allowOvernight: false };
  const now = Timestamp.now();
  const entRef = adminDb.collection('entitlements').doc();
  const batch = adminDb.batch();
  // The username is reserved like anyone's, so a later registration can't take it.
  batch.create(adminDb.collection('identifiers').doc(username), { personId, kind: 'username', createdAt: now });
  batch.create(adminDb.collection('people').doc(personId), {
    personId, firstName: input.firstName, lastName: input.lastName, username, commEmail: input.email, edcEmail: null,
    mobile: input.mobile, photoDataUrl: null, purpose: input.purpose, profileType: 'visitor', systemRole: 'member',
    parentId, ancestorIds, registrationStatus: 'APPROVED', registrationDecision: { by: actor.personId, at: now, note: null },
    accessNumber, credentialVersion: 1, active: true, createdAt: now, createdBy: actor.personId,
    hasAccount: false, hostId: actor.personId, vvip: input.vvip, emailVerified: false,
  });
  batch.create(entRef, {
    personId, profileTypeAtGrant: 'visitor', ...window, state: 'ACTIVE', sourceRequestId: null,
    approvedBy: actor.personId, approvedAt: now, revokedBy: null, revokedAt: null, revokeReason: null, createdAt: now,
  });
  const code = accessCodeFor('visitor', accessNumber)!;
  audit(batch, { action: 'VISITOR_PASS_CREATED', actor, targetPersonId: personId, at: now, details: `${input.vvip ? 'VVIP ' : ''}visitor ${input.firstName} ${input.lastName}, ${code}, host ${host.firstName} ${host.lastName}` });
  audit(batch, { action: 'ENTITLEMENT_CREATED', actor, targetPersonId: personId, subjectId: entRef.id, at: now, details: `visitor pass: ${windowSummary(window)}` });
  try {
    await batch.commit();
  } catch (err) {
    await adminDb.collection('accessNumbers').doc(accessNumber).delete().catch(() => {});
    throw err;
  }
  const passUrl = visitorPassUrl(origin, { personId, credentialVersion: 1 });
  if (input.email) after(() => notifyVisitorPass(personId, passUrl, window).then(() => {}, (e) => console.error('Visitor pass email failed', e)));
  return { personId, accessCode: code, passUrl, access: windowSummary(window), emailed: !!input.email };
}

export interface VisitorSummary {
  personId: string; firstName: string; lastName: string; vvip?: boolean; hostId?: string; accessNumber: string; credentialVersion: number;
  createdAt?: Timestamp; purpose?: string; commEmail?: string | null; active?: boolean; lastEntryAt?: Timestamp; onCampus?: boolean;
}

/** Visitors this person invited (Master: everyone's), newest first. */
export async function listVisitors(actor: SessionUser, limit = 100): Promise<VisitorSummary[]> {
  const base = adminDb.collection('people').where('profileType', '==', 'visitor');
  const q = actor.systemRole === 'master' ? base : base.where('hostId', '==', actor.personId);
  const snap = await q.select('firstName', 'lastName', 'vvip', 'hostId', 'accessNumber', 'credentialVersion', 'createdAt', 'purpose', 'commEmail', 'active', 'lastEntryAt', 'onCampus').get();
  return snap.docs.map((d) => ({ ...(d.data() as Omit<VisitorSummary, 'personId'>), personId: d.id }))
    .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)).slice(0, limit);
}
