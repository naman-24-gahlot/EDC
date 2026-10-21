// SERVER-ONLY. Master-only profile-type change — DATABASE_SCHEMA.md "Profile-type change":
// history entry, prefix follows the new type (digits stay, old code string becomes
// "Code superseded"), credentialVersion++, ACTIVE entitlement → SUPERSEDED and, if it was
// still in force, replaced by the new type's default period (benefits follow the type).
if (typeof window !== 'undefined') {
  throw new Error('lib/people/profileType.ts must never be imported into client code.');
}

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { SessionUser } from '@/lib/session';
import { HttpError, requireMaster, toPerson } from '@/lib/hierarchy/authorize';
import { accessCodeFor, SUBORDINATE_PROFILE_TYPES, type ProfileType } from '@/lib/access/codes';
import { effectiveStatus, templateWindow } from '@/lib/access/entitlements';
import { todayDateString } from '@/lib/date';

const TOP_LEVEL_TYPES: readonly ProfileType[] = ['employee', 'incubee'];

export async function changeProfileType(actor: SessionUser, personId: string, newType: ProfileType) {
  requireMaster(actor);
  const people = adminDb.collection('people');
  const personRef = people.doc(personId);

  return adminDb.runTransaction(async (tx) => {
    const person = toPerson(await tx.get(personRef));
    if (!person) throw new HttpError(404, 'Person not found.');
    if (person.systemRole !== 'member' || !person.profileType) {
      throw new HttpError(400, 'Masters and guards keep their type — demote a Master first.');
    }
    const oldType = person.profileType;
    if (oldType === newType) throw new HttpError(409, `Already ${newType}.`);

    const [descendants, entitlements] = await Promise.all([
      tx.get(people.where('ancestorIds', 'array-contains', personId)),
      tx.get(adminDb.collection('entitlements').where('personId', '==', personId)),
    ]);
    if (oldType === 'employee' && newType !== 'employee' && !descendants.empty) {
      throw new HttpError(409, `This employee has ${descendants.size} person(s) under them — rehome them first.`);
    }

    // Subordinate types must sit under an employee; employee/incubee become top-level.
    let hierarchy: { parentId: string | null; ancestorIds: string[] } | null = null;
    if (TOP_LEVEL_TYPES.includes(newType) && person.parentId !== null && !TOP_LEVEL_TYPES.includes(oldType)) {
      hierarchy = { parentId: null, ancestorIds: [] };
    }
    if (SUBORDINATE_PROFILE_TYPES.includes(newType) && person.parentId === null) {
      throw new HttpError(400, 'A driver, relative, bodyguard or event guest needs a parent — rehome them under an employee first.');
    }

    const now = Timestamp.now();
    const oldCode = accessCodeFor(oldType, person.accessNumber);
    const newCode = accessCodeFor(newType, person.accessNumber);
    const active = entitlements.docs.filter((d) => d.data().state === 'ACTIVE');
    // Access in force (or scheduled) carries over as the NEW type's default period — e.g. a
    // relative's 30 days become an employee's open-ended access, and the reverse shortens it.
    // Expired or no access stays that way: a type change never creates access from nothing.
    const today = todayDateString();
    const inForce = active
      .map((d) => d.data() as { state: 'ACTIVE'; startDate: string; endDate: string | null })
      .filter((e) => effectiveStatus(e, today) !== 'EXPIRED');
    const carryStart = inForce.length ? inForce.map((e) => e.startDate).reduce((a, b) => (a < b ? a : b)) : null;
    const carried = carryStart ? templateWindow(newType, carryStart > today ? carryStart : today) : null;
    const carriedRef = carried ? adminDb.collection('entitlements').doc() : null;

    tx.set(personRef.collection('profileHistory').doc(), {
      fromProfileType: oldType,
      toProfileType: newType,
      changedBy: actor.personId,
      changedAt: now,
      reason: null,
      retiredAccessCode: oldCode,
      newAccessCode: newCode,
      credentialVersionAfter: person.credentialVersion + 1,
      supersededEntitlementIds: active.map((d) => d.id),
      grantedEntitlementId: carriedRef?.id ?? null,
    });
    tx.update(personRef, {
      profileType: newType,
      credentialVersion: FieldValue.increment(1),
      ...(hierarchy ?? {}),
    });
    for (const d of active) {
      tx.update(d.ref, { state: 'SUPERSEDED' });
      tx.set(adminDb.collection('auditLogs').doc(), {
        action: 'ENTITLEMENT_SUPERSEDED', actorId: actor.personId, actorRole: actor.systemRole,
        targetPersonId: personId, subjectId: d.id, timestamp: now, details: `profile type ${oldType} → ${newType}`,
      });
    }
    if (carried && carriedRef) {
      tx.create(carriedRef, {
        personId, profileTypeAtGrant: newType, ...carried, state: 'ACTIVE', sourceRequestId: null,
        approvedBy: actor.personId, approvedAt: now, revokedBy: null, revokedAt: null, revokeReason: null, createdAt: now,
      });
      tx.set(adminDb.collection('auditLogs').doc(), {
        action: 'ENTITLEMENT_CREATED', actorId: actor.personId, actorRole: actor.systemRole,
        targetPersonId: personId, subjectId: carriedRef.id, timestamp: now,
        details: `${newType} default after type change: ${carried.startDate} → ${carried.endDate ?? 'open'}, days ${carried.weekdays.join('')}, ${carried.startTime}–${carried.endTime}`,
      });
    }
    tx.set(adminDb.collection('auditLogs').doc(), {
      action: 'PROFILE_TYPE_CHANGED', actorId: actor.personId, actorRole: actor.systemRole,
      targetPersonId: personId, subjectId: null, timestamp: now,
      details: `${oldType} → ${newType}; code ${oldCode ?? '—'} → ${newCode ?? '—'}${hierarchy ? '; moved to top-level' : ''}`,
    });

    return { personId, profileType: newType, accessCode: newCode, supersededEntitlements: active.length, grantedDefault: carried, movedToTopLevel: !!hierarchy };
  });
}
