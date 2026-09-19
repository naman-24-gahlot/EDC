import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { createPerson, PersonCreateError } from '@/lib/people/create';
import { isProfileType, SUBORDINATE_PROFILE_TYPES } from '@/lib/access/codes';

function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

// An approved, active employee (or Master) creates a subordinate directly — the
// creator IS that subordinate's authorized approver, so it's written APPROVED
// immediately. See DATABASE_SCHEMA.md's Registration state machine.
//
// Temporary authority check: P4 replaces this "is the actor literally an employee"
// test with assertCanActOn built on ancestorIds; for creating a brand-new person
// there's no existing target to check ancestry against, so this stays simple even
// after P4 — it's not standing in for anything more sophisticated.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  if (user.systemRole !== 'master') {
    const actorSnap = await adminDb.collection('people').doc(user.personId).get();
    const actor = actorSnap.data();
    if (
      !actor ||
      actor.profileType !== 'employee' ||
      actor.registrationStatus !== 'APPROVED' ||
      actor.active !== true
    ) {
      return NextResponse.json(
        { error: 'Only an active employee or Master can add a person.' },
        { status: 403 }
      );
    }
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const profileType = body.profileType;
  if (!isProfileType(profileType) || !SUBORDINATE_PROFILE_TYPES.includes(profileType)) {
    return NextResponse.json(
      { error: 'Can only add a driver, relative, bodyguard, or event guest here.' },
      { status: 400 }
    );
  }

  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const username = typeof body.username === 'string' ? body.username : '';
  const commEmail = typeof body.commEmail === 'string' ? body.commEmail.trim() : '';
  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : '';
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  const photoDataUrl = typeof body.photoDataUrl === 'string' ? body.photoDataUrl : null;

  if (!firstName || !lastName || !mobile || !purpose) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }

  const password = generatePassword();

  let created;
  try {
    created = await createPerson(
      { firstName, lastName, username, commEmail, mobile, purpose, profileType, password, photoDataUrl },
      { createdBy: user.personId, parentId: user.personId, registrationStatus: 'APPROVED' }
    );
  } catch (err) {
    if (err instanceof PersonCreateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Failed to create subordinate', err);
    return NextResponse.json({ error: 'Could not create person.' }, { status: 500 });
  }

  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'REGISTRATION_SUBMITTED',
    actorId: user.personId,
    actorRole: user.systemRole,
    targetPersonId: created.personId,
    subjectId: null,
    timestamp: now,
    details: `profileType=${profileType}`,
  });
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'REGISTRATION_APPROVED',
    actorId: user.personId,
    actorRole: user.systemRole,
    targetPersonId: created.personId,
    subjectId: null,
    timestamp: now,
    details: created.accessCode ? `accessCode=${created.accessCode}` : null,
  });
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'PROFILE_CREATED',
    actorId: user.personId,
    actorRole: user.systemRole,
    targetPersonId: created.personId,
    subjectId: null,
    timestamp: now,
    details: null,
  });
  await batch.commit();

  return NextResponse.json(
    {
      personId: created.personId,
      username: created.username,
      commEmail: created.commEmail,
      password,
      accessCode: created.accessCode,
    },
    { status: 201 }
  );
}
