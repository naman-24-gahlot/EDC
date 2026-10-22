// SERVER-ONLY. Registration approval — DATABASE_SCHEMA.md "Registration approval".
// The approver may approve under a different profile type than the one applied for; the person
// gets their access code AND the approved type's default access in the same transaction, and a
// one-time notice on their account if the type was changed.
if (typeof window !== 'undefined') {
  throw new Error('lib/people/approveRegistration.ts must never be imported into client code.');
}

import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, assertCanActOn, toPerson } from '@/lib/hierarchy/authorize';
import { SUBORDINATE_PROFILE_TYPES, accessCodeFor, issueAccessNumber, type ProfileType } from '@/lib/access/codes';
import { templateWindow } from '@/lib/access/entitlements';
import { todayDateString } from '@/lib/date';
import { PROFILE_LABEL, windowSummary } from '@/lib/display';
import { eventWindow, loadEvent } from '@/lib/events';

/** Types this approver may approve someone as. A parent employee keeps them a dependant. */
export function approvableTypes(actor: SessionUser): readonly ProfileType[] {
  return actor.systemRole === 'master'
    ? ['employee', 'incubee', 'event_guest', 'driver', 'relative', 'bodyguard']
    : SUBORDINATE_PROFILE_TYPES;
}

/** The "Approve as" choices for this approver, each with the access it would grant today. */
export function approveOptions(actor: SessionUser) {
  const today = todayDateString();
  return approvableTypes(actor).map((type) => ({ type, label: PROFILE_LABEL[type], access: windowSummary(templateWindow(type, today)) }));
}

export async function approveRegistration(actor: SessionUser, personId: string, requestedType: ProfileType | undefined) {
  const before = await assertCanActOn(actor, personId); // Master, or an ancestor of the person
  const isMaster = actor.systemRole === 'master';
  if (before.registrationStatus === 'APPROVED') throw new HttpError(409, 'Already approved.');
  if (before.registrationStatus === 'REJECTED' && !isMaster) throw new HttpError(403, 'Only Master can re-approve a rejected registration.');
  if (!before.profileType) throw new HttpError(400, 'This account has no profile type to approve.');

  const appliedAs = before.profileType;
  const approvedAs = requestedType ?? appliedAs;
  if (!approvableTypes(actor).includes(approvedAs)) {
    throw new HttpError(403, 'You can approve your people only as a driver, relative, bodyguard or event guest.');
  }

  // Hierarchy follows the approved type: dependants need a parent (the approving Master if
  // they had none); employees and incubees are top-level.
  let hierarchy: { parentId: string | null; ancestorIds: string[] } | null = null;
  if (SUBORDINATE_PROFILE_TYPES.includes(approvedAs) && before.parentId === null) {
    const me = toPerson(await adminDb.collection('people').doc(actor.personId).get());
    if (!me || me.profileType !== 'employee') throw new HttpError(400, 'Only an employee can be a parent — approve them as an employee or incubee instead.');
    hierarchy = { parentId: me.personId, ancestorIds: [...me.ancestorIds, me.personId] };
  } else if (!SUBORDINATE_PROFILE_TYPES.includes(approvedAs) && before.parentId !== null) {
    hierarchy = { parentId: null, ancestorIds: [] };
  }

  // Unique number first (its own create()); harmless if the approval below then fails.
  const accessNumber = before.accessNumber ?? (await issueAccessNumber(personId));
  const personRef = adminDb.collection('people').doc(personId);
  const entRef = adminDb.collection('entitlements').doc();
  // Event registrants get the event's days and hours; everyone else their type's default.
  const event = typeof before.eventId === 'string' ? await loadEvent(before.eventId) : null;
  // An event that has already ended gives no access (approval still records the person).
  const today = todayDateString();
  const window = event ? (event.accessTo >= today ? eventWindow(event, today) : null) : templateWindow(approvedAs, today);

  return adminDb.runTransaction(async (tx) => {
    const fresh = toPerson(await tx.get(personRef));
    if (!fresh) throw new HttpError(404, 'Person not found.');
    if (fresh.registrationStatus === 'APPROVED') throw new HttpError(409, 'Already approved.');

    const now = Timestamp.now();
    const changed = approvedAs !== appliedAs;
    const audit = (action: string, subjectId: string | null, details: string | null) =>
      tx.set(adminDb.collection('auditLogs').doc(), {
        action, actorId: actor.personId, actorRole: actor.systemRole, targetPersonId: personId, subjectId, timestamp: now, details,
      });

    tx.update(personRef, {
      registrationStatus: 'APPROVED',
      registrationDecision: { by: actor.personId, at: now, note: null, appliedProfileType: appliedAs },
      profileType: approvedAs,
      accessNumber,
      active: true,
      ...(hierarchy ?? {}),
      // Shown once on their account; `seenAt` is set when they dismiss it (never deleted).
      ...(changed ? { approvalNotice: { appliedAs, approvedAs, by: actor.personId, at: now, seenAt: null } } : {}),
    });
    if (window) tx.create(entRef, {
      personId, profileTypeAtGrant: approvedAs, ...window, state: 'ACTIVE', sourceRequestId: null,
      approvedBy: actor.personId, approvedAt: now, revokedBy: null, revokedAt: null, revokeReason: null, createdAt: now,
    });
    const code = accessCodeFor(approvedAs, accessNumber);
    audit('REGISTRATION_APPROVED', null, `accessCode=${code}${changed ? `; applied as ${appliedAs}, approved as ${approvedAs}` : ''}${hierarchy ? (hierarchy.parentId ? '; placed under approver' : '; moved to top-level') : ''}`);
    if (window) audit('ENTITLEMENT_CREATED', entRef.id, `${event ? `event "${event.name}"` : `${approvedAs} default`} on approval: ${window.startDate} → ${window.endDate ?? 'open'}, days ${window.weekdays.join('')}, ${window.startTime}–${window.endTime}`);

    return { personId, accessCode: code, profileType: approvedAs, appliedAs, access: window };
  });
}

/** PENDING → REJECTED, by Master or the person's ancestor. The person and identifiers are kept. */
export async function rejectRegistration(actor: SessionUser, personId: string, note: string | null) {
  const person = await assertCanActOn(actor, personId);
  if (person.registrationStatus !== 'PENDING') throw new HttpError(409, `Cannot reject a ${person.registrationStatus.toLowerCase()} registration.`);
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.update(adminDb.collection('people').doc(personId), {
    registrationStatus: 'REJECTED',
    registrationDecision: { by: actor.personId, at: now, note },
  });
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'REGISTRATION_REJECTED', actorId: actor.personId, actorRole: actor.systemRole,
    targetPersonId: personId, subjectId: null, timestamp: now, details: note,
  });
  await batch.commit();
  return { personId };
}
