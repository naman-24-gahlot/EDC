import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { createPerson, PersonCreateError } from '@/lib/people/create';
import { accessCodeFor, isProfileType, SUBORDINATE_PROFILE_TYPES } from '@/lib/access/codes';
import { LIST_FIELDS, listDescendants, toPerson, type PersonRecord } from '@/lib/hierarchy/authorize';
import { templateWindow } from '@/lib/access/entitlements';
import { todayDateString } from '@/lib/date';
import { audit } from '@/lib/audit';

function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

// Master sees everyone; anyone else sees only their own descendants — an ancestorIds
// query, never a filtered broader list.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  // Gate staff have nobody under them and no requests of their own.
  if (user.systemRole === 'guard') return NextResponse.json({ error: 'Not available to guards.' }, { status: 403 });

  const people: PersonRecord[] =
    user.systemRole === 'master'
      ? (await adminDb.collection('people').select(...LIST_FIELDS).get()).docs.map((doc) => toPerson(doc)!)
      : await listDescendants(user.personId);

  return NextResponse.json({
    people: people
      .map((p) => ({
        personId: p.personId,
        firstName: p.firstName,
        lastName: p.lastName,
        username: p.username,
        profileType: p.profileType,
        systemRole: p.systemRole,
        parentId: p.parentId,
        depth: p.ancestorIds.length,
        registrationStatus: p.registrationStatus,
        active: p.active,
        accessCode: accessCodeFor(p.profileType, p.accessNumber),
      }))
      .sort((a, b) => a.depth - b.depth || a.firstName.localeCompare(b.firstName)),
  });
}

// An approved, active employee (or Master) creates a subordinate directly — the
// creator IS that subordinate's authorized approver, so it's written APPROVED
// immediately. There's no existing target to run assertCanActOn against: the new
// person's ancestorIds are derived server-side from the creator, never from the body.
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
  // Approved at creation, so access starts at creation too: the type's default period.
  const window = templateWindow(profileType, todayDateString());
  const entRef = adminDb.collection('entitlements').doc();
  batch.create(entRef, {
    personId: created.personId, profileTypeAtGrant: profileType, ...window, state: 'ACTIVE', sourceRequestId: null,
    approvedBy: user.personId, approvedAt: now, revokedBy: null, revokedAt: null, revokeReason: null, createdAt: now,
  });
  audit(batch, {
    action: 'ENTITLEMENT_CREATED', actor: user, targetPersonId: created.personId, subjectId: entRef.id, at: now,
    details: `${profileType} default on creation: ${window.startDate} → ${window.endDate ?? 'open'}, days ${window.weekdays.join('')}, ${window.startTime}–${window.endTime}`,
  });
  audit(batch, { action: 'REGISTRATION_SUBMITTED', actor: user, targetPersonId: created.personId, at: now, details: `profileType=${profileType}` });
  audit(batch, { action: 'REGISTRATION_APPROVED', actor: user, targetPersonId: created.personId, at: now, details: created.accessCode ? `accessCode=${created.accessCode}` : null });
  audit(batch, { action: 'PROFILE_CREATED', actor: user, targetPersonId: created.personId, at: now });
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
