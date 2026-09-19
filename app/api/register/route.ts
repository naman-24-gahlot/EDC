import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { createPerson, PersonCreateError } from '@/lib/people/create';
import { resolveEmployeeParent } from '@/lib/people/resolveParent';
import { isProfileType, SUBORDINATE_PROFILE_TYPES } from '@/lib/access/codes';

// Public, unauthenticated. Can only ever create a PENDING person — approval is the
// real gate, so a public link needs no invite token. See SECURITY_MODEL.md
// "Registration and approval authority".
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const username = typeof body.username === 'string' ? body.username : '';
  const commEmail = typeof body.commEmail === 'string' ? body.commEmail.trim() : '';
  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : '';
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const profileType = body.profileType;
  const parentIdentifier =
    typeof body.parentIdentifier === 'string' ? body.parentIdentifier.trim() : '';
  const photoDataUrl = typeof body.photoDataUrl === 'string' ? body.photoDataUrl : null;

  if (!firstName || !lastName || !mobile || !purpose) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }
  if (!isProfileType(profileType)) {
    return NextResponse.json({ error: 'Invalid profile type.' }, { status: 400 });
  }

  let parentId: string | null = null;
  if (SUBORDINATE_PROFILE_TYPES.includes(profileType)) {
    if (!parentIdentifier) {
      return NextResponse.json(
        {
          error:
            "This profile type needs your controlling employee's username or access code.",
        },
        { status: 400 }
      );
    }
    parentId = await resolveEmployeeParent(parentIdentifier);
    if (!parentId) {
      return NextResponse.json(
        { error: 'Could not find an approved, active employee with that username or access code.' },
        { status: 400 }
      );
    }
  }

  let created;
  try {
    created = await createPerson(
      { firstName, lastName, username, commEmail, mobile, purpose, profileType, password, photoDataUrl },
      { createdBy: 'self', parentId, registrationStatus: 'PENDING' }
    );
  } catch (err) {
    if (err instanceof PersonCreateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Registration failed', err);
    return NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 });
  }

  const auditRef = adminDb.collection('auditLogs').doc();
  await auditRef.set({
    action: 'REGISTRATION_SUBMITTED',
    actorId: 'public',
    actorRole: 'public',
    targetPersonId: created.personId,
    subjectId: null,
    timestamp: Timestamp.now(),
    details: `profileType=${profileType}`,
  });

  return NextResponse.json({ personId: created.personId }, { status: 201 });
}
