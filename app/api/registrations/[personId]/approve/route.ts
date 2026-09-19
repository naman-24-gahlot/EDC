import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { accessCodeFor, issueAccessNumber, type ProfileType } from '@/lib/access/codes';

// Temporary authority check — P4 replaces this with assertCanActOn(actor, target)
// built on ancestorIds. For now: Master anywhere, or the person's exact named parent.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { personId } = await params;
  const personRef = adminDb.collection('people').doc(personId);
  const snap = await personRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
  }
  const person = snap.data()!;

  const isMaster = user.systemRole === 'master';
  const isNamedParent = person.parentId === user.personId;
  if (!isMaster && !isNamedParent) {
    return NextResponse.json(
      { error: 'Not authorized to approve this registration.' },
      { status: 403 }
    );
  }
  if (person.registrationStatus === 'APPROVED') {
    return NextResponse.json({ error: 'Already approved.' }, { status: 409 });
  }
  if (person.registrationStatus === 'REJECTED' && !isMaster) {
    return NextResponse.json(
      { error: 'Only Master can re-approve a rejected registration.' },
      { status: 403 }
    );
  }

  let accessNumber = (person.accessNumber as string | null) ?? null;
  if (!accessNumber && person.profileType) {
    accessNumber = await issueAccessNumber(personId);
  }
  const accessCode = accessCodeFor(person.profileType as ProfileType | null, accessNumber);

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
