// SERVER-ONLY. Event registrations shaped by the event's options (lib/events.ts EventOptions):
//  - quick sign-up with NO password (requirePassword: false): an event guest with no sign-in
//    account (`hasAccount: false`, like a visitor) — no password is ever asked for or stored. Their
//    pass is the private link /v/<credential> and a printed card. Username "guest-…" is reserved.
//  - approval on the spot (autoApprove): approved by the system at once, with access for exactly
//    the event's days and hours (nothing more), and the pass returned for printing.
// Both are audited like any registration (actor "public" for the sign-up, "system" for the
// approval, with the event setting named in the details).
if (typeof window !== 'undefined') {
  throw new Error('lib/eventGuests.ts must never be imported into client code.');
}

import { after } from 'next/server';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { todayDateString } from '@/lib/date';
import { HttpError, computeAncestorIds, loadPerson, toPerson } from '@/lib/hierarchy/authorize';
import { accessCodeFor, issueAccessNumber } from '@/lib/access/codes';
import { passTokenFor } from '@/lib/access/credential';
import { checkMobile } from '@/lib/phone';
import { validatePhoto } from '@/lib/people/create';
import { resolveEmployeeParent } from '@/lib/people/resolveParent';
import { eventOptions, eventWindow, parseSource, type EventRecord } from '@/lib/events';
import { audit } from '@/lib/audit';
import { notifyEventPass } from '@/lib/notify';

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

export interface QuickInput { firstName: string; lastName: string; mobile: string; email: string | null; purpose: string; parentIdentifier: string; photoDataUrl: string | null; source: ReturnType<typeof parseSource> }

export function parseQuickInput(body: unknown): QuickInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const str = (k: string, max = 200) => (typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '');
  const firstName = str('firstName', 60), lastName = str('lastName', 60);
  if (!NAME_RE.test(firstName) || !NAME_RE.test(lastName)) throw new HttpError(400, 'Enter your first and last name (letters only).');
  const m = checkMobile(str('mobile', 30));
  if (!m.ok) throw new HttpError(400, m.message ?? 'Enter a valid mobile number.');
  const email = str('email', 254).toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email, or leave it empty.');
  return {
    firstName, lastName, mobile: m.value!, email, purpose: str('purpose') || 'Event guest', parentIdentifier: str('parentIdentifier', 60),
    photoDataUrl: typeof b.photoDataUrl === 'string' ? validatePhoto(b.photoDataUrl) : null, source: parseSource(b.source),
  };
}

export interface RegisteredGuest { personId: string; status: 'PENDING' | 'APPROVED'; passToken: string | null; accessCode: string | null; emailed: boolean }

/** No-password sign-up for an event whose link says so. */
export async function registerQuickGuest(event: EventRecord, input: QuickInput, origin: string): Promise<RegisteredGuest> {
  const opts = eventOptions(event);
  if (opts.requirePassword) throw new HttpError(400, 'This event needs a full registration.');
  // The same phone number twice for one event is almost always someone registering again.
  const dup = await adminDb.collection('people').where('eventId', '==', event.id).where('mobile', '==', input.mobile).limit(1).get();
  if (!dup.empty) throw new HttpError(409, 'This mobile number is already registered for this event — ask the organisers to reprint your pass.');

  let parentId: string | null = null;
  let ancestorIds: string[] = [];
  if (input.parentIdentifier) {
    parentId = await resolveEmployeeParent(input.parentIdentifier);
    if (!parentId) throw new HttpError(400, 'We couldn’t find that employee — check the username or access code, or leave it empty.');
    ancestorIds = computeAncestorIds((await loadPerson(parentId))!);
  }

  const personId = adminDb.collection('people').doc().id;
  const username = `guest-${randomBytes(4).toString('hex')}`;
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.create(adminDb.collection('identifiers').doc(username), { personId, kind: 'username', createdAt: now });
  batch.create(adminDb.collection('people').doc(personId), {
    personId, firstName: input.firstName, lastName: input.lastName, username, commEmail: input.email, edcEmail: null,
    mobile: input.mobile, photoDataUrl: input.photoDataUrl, purpose: input.purpose, profileType: 'event_guest', systemRole: 'member',
    parentId, ancestorIds, registrationStatus: 'PENDING', registrationDecision: null, accessNumber: null, credentialVersion: 1,
    active: false, createdAt: now, createdBy: 'self', hasAccount: false, emailVerified: false,
    eventId: event.id, eventName: event.name, registrationSource: input.source,
  });
  audit(batch, { action: 'REGISTRATION_SUBMITTED', actor: 'public', targetPersonId: personId, eventId: event.id, at: now, details: `quick sign-up (no password) for event: ${event.name}` });
  await batch.commit();

  if (!opts.autoApprove) return { personId, status: 'PENDING', passToken: null, accessCode: null, emailed: false };
  return approveOnTheSpot(personId, event, origin);
}

/**
 * Approval by the event's own setting: access for the event's days and hours, nothing more.
 * Used right after a quick sign-up, and after a full registration on an auto-approve link.
 */
export async function approveOnTheSpot(personId: string, event: EventRecord, origin: string): Promise<RegisteredGuest> {
  const today = todayDateString();
  if (event.accessTo < today) throw new HttpError(409, 'This event is over.');
  const accessNumber = await issueAccessNumber(personId);
  const window = eventWindow(event, today);
  const ref = adminDb.collection('people').doc(personId);
  const entRef = adminDb.collection('entitlements').doc();
  await adminDb.runTransaction(async (tx) => {
    const fresh = toPerson(await tx.get(ref));
    if (!fresh || fresh.registrationStatus !== 'PENDING' || fresh.eventId !== event.id) throw new HttpError(409, 'Already decided.');
    const now = Timestamp.now();
    tx.update(ref, { registrationStatus: 'APPROVED', registrationDecision: { by: 'system', at: now, note: 'approved on the spot (event setting)', appliedProfileType: 'event_guest' }, profileType: 'event_guest', accessNumber, active: true });
    tx.create(entRef, { personId, profileTypeAtGrant: 'event_guest', ...window, state: 'ACTIVE', sourceRequestId: null, approvedBy: 'system', approvedAt: now, revokedBy: null, revokedAt: null, revokeReason: null, createdAt: now });
    audit(tx, { action: 'REGISTRATION_APPROVED', actor: 'system', targetPersonId: personId, eventId: event.id, at: now, details: `approved on the spot (event "${event.name}" setting); accessCode=${accessCodeFor('event_guest', accessNumber)}` });
    audit(tx, { action: 'ENTITLEMENT_CREATED', actor: 'system', targetPersonId: personId, subjectId: entRef.id, eventId: event.id, at: now, details: `event "${event.name}" on approval: ${window.startDate} → ${window.endDate}, ${window.startTime}–${window.endTime}` });
  });
  const person = (await loadPerson(personId))!;
  const passToken = passTokenFor(person);
  const emailed = eventOptions(event).emailPass && typeof person.commEmail === 'string' && !!person.commEmail;
  if (emailed) after(() => notifyEventPass(personId, origin, passToken).then(() => {}, (e: unknown) => console.error('Event pass email failed', e)));
  return { personId, status: 'APPROVED', passToken, accessCode: accessCodeFor('event_guest', accessNumber), emailed };
}
