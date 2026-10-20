import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { accessCodeFor, issueAccessNumber } from '@/lib/access/codes';
import { assertCanActOn, errorResponse, type PersonRecord } from '@/lib/hierarchy/authorize';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { personId } = await params;
  let person: PersonRecord;
  try {
    person = await assertCanActOn(user, personId);
  } catch (err) {
    return errorResponse(err);
  }
  const personRef = adminDb.collection('people').doc(personId);
  const isMaster = user.systemRole === 'master';

  if (person.registrationStatus === 'APPROVED') {
    return NextResponse.json({ error: 'Already approved.' }, { status: 409 });
  }
  if (person.registrationStatus === 'REJECTED' && !isMaster) {
    return NextResponse.json(
      { error: 'Only Master can re-approve a rejected registration.' },
      { status: 403 }
    );
  }

  let accessNumber = person.accessNumber ?? null;
  if (!accessNumber && person.profileType) {
    accessNumber = await issueAccessNumber(personId);
  }
  const accessCode = accessCodeFor(person.profileType, accessNumber);

  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.update(personRef, {
    registrationStatus: 'APPROVED',
    registrationDecision: { by: user.personId, at: now, note: null },
    accessNumber,
    active: true,
  });
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'REGISTRATION_APPROVED',
    actorId: user.personId,
    actorRole: user.systemRole,
    targetPersonId: personId,
    subjectId: null,
    timestamp: now,
    details: accessCode ? `accessCode=${accessCode}` : null,
  });
  await batch.commit();

  return NextResponse.json({ personId, accessCode });
}
