import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { todayDateString } from '@/lib/date';

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 6) return true; // gRPC ALREADY_EXISTS
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('ALREADY_EXISTS');
}

// Creates today's access request for the signed-in employee. The uid is taken only
// from the verified session cookie — never from the request body. "One request per
// day" is enforced by the deterministic doc ID colliding on a second attempt, not
// just by this check, so it holds even under a race.
export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (user.role !== 'employee') {
    return NextResponse.json({ error: 'Only employees can request entry' }, { status: 403 });
  }

  const date = todayDateString();
  const requestId = `${user.uid}_${date}`;
  const requestRef = adminDb.collection('requests').doc(requestId);
  const auditRef = adminDb.collection('auditLogs').doc();

  const userDoc = await adminDb.collection('users').doc(user.uid).get();
  const employeeName =
    (userDoc.data()?.displayName as string | undefined) ?? user.email ?? user.uid;

  const batch = adminDb.batch();
  batch.create(requestRef, {
    requestId,
    employeeId: user.uid,
    employeeName,
    date,
    status: 'PENDING',
    requestedAt: Timestamp.now(),
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    passNonce: null,
    passIssuedAt: null,
    checkedInBy: null,
    checkedInAt: null,
  });
  batch.set(auditRef, {
    logId: auditRef.id,
    action: 'REQUEST_CREATED',
    requestId,
    actorId: user.uid,
    actorRole: 'employee',
    targetEmployeeId: user.uid,
    timestamp: Timestamp.now(),
    details: null,
  });

  try {
    await batch.commit();
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      return NextResponse.json(
        { error: 'You already have a request for today.' },
        { status: 409 }
      );
    }
    console.error('Failed to create access request', err);
    return NextResponse.json({ error: 'Could not create request' }, { status: 500 });
  }

  return NextResponse.json({ requestId, status: 'PENDING' }, { status: 201 });
}
