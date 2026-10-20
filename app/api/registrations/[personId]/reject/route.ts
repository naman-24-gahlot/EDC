import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { assertCanActOn, errorResponse, type PersonRecord } from '@/lib/hierarchy/authorize';

export async function POST(
  request: NextRequest,
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

  if (person.registrationStatus !== 'PENDING') {
    return NextResponse.json(
      { error: `Cannot reject a ${person.registrationStatus} registration.` },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  const rawNote = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const note = rawNote.length > 0 ? rawNote : null;

  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.update(personRef, {
    registrationStatus: 'REJECTED',
    registrationDecision: { by: user.personId, at: now, note },
  });
  batch.set(adminDb.collection('auditLogs').doc(), {
    action: 'REGISTRATION_REJECTED',
    actorId: user.personId,
    actorRole: user.systemRole,
    targetPersonId: personId,
    subjectId: null,
    timestamp: now,
    details: note,
  });
  await batch.commit();

  return NextResponse.json({ personId });
}
