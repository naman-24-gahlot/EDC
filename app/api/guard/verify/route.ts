import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { parsePassToken, verifyPassSignature } from '@/lib/qr-token';
import { todayDateString } from '@/lib/date';

type DenyReason =
  | 'Malformed token'
  | 'Invalid token signature'
  | 'Unknown request'
  | 'Access has been revoked'
  | 'Already checked in today'
  | 'Request not approved'
  | 'Token no longer valid'
  | 'Pass has expired'
  | 'Server error — try again';

function statusReason(status: string): DenyReason {
  if (status === 'REVOKED') return 'Access has been revoked';
  if (status === 'CHECKED_IN') return 'Already checked in today';
  return 'Request not approved';
}

async function logDenial(
  actorId: string,
  requestId: string | null,
  targetEmployeeId: string | null,
  reason: DenyReason
) {
  const auditRef = adminDb.collection('auditLogs').doc();
  await auditRef.set({
    logId: auditRef.id,
    action: 'CHECK_IN_DENIED',
    requestId,
    actorId,
    actorRole: 'guard',
    targetEmployeeId,
    timestamp: Timestamp.now(),
    details: reason,
  });
}

// This is the ONLY verification path — the manual-entry fallback on the guard page
// posts here too, not to a separate/weaker route. All checks are server-side; the
// client only ever displays what this route decides. See SECURITY_MODEL.md.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.role !== 'guard') {
    return NextResponse.json({ error: 'Only guards can verify passes' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const rawToken = typeof body?.token === 'string' ? body.token : '';

  const parsed = parsePassToken(rawToken);
  if (!parsed) {
    await logDenial(user.uid, null, null, 'Malformed token');
    return NextResponse.json({ approved: false, reason: 'Malformed token' });
  }
  const { requestId, nonce, signature } = parsed;

  if (!verifyPassSignature(requestId, nonce, signature)) {
    await logDenial(user.uid, requestId, null, 'Invalid token signature');
    return NextResponse.json({ approved: false, reason: 'Invalid token signature' });
  }

  const requestRef = adminDb.collection('requests').doc(requestId);
  const preSnap = await requestRef.get();
  if (!preSnap.exists) {
    await logDenial(user.uid, requestId, null, 'Unknown request');
    return NextResponse.json({ approved: false, reason: 'Unknown request' });
  }

  const preData = preSnap.data()!;
  const employeeId = preData.employeeId as string;
  const employeeName = preData.employeeName as string;

  if (preData.status !== 'APPROVED') {
    const reason = statusReason(preData.status as string);
    await logDenial(user.uid, requestId, employeeId, reason);
    return NextResponse.json({ approved: false, reason });
  }
  if (preData.passNonce !== nonce) {
    await logDenial(user.uid, requestId, employeeId, 'Token no longer valid');
    return NextResponse.json({ approved: false, reason: 'Token no longer valid' });
  }
  if (preData.date !== todayDateString()) {
    await logDenial(user.uid, requestId, employeeId, 'Pass has expired');
    return NextResponse.json({ approved: false, reason: 'Pass has expired' });
  }

  // Pre-checks passed. Re-verify inside a transaction so a concurrent double-scan
  // can't both succeed — the loser re-reads status as already CHECKED_IN here.
  let denialReason: DenyReason | null = null;
  try {
    await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(requestRef);
      const data = snap.data();
      if (!data) {
        denialReason = 'Unknown request';
        return;
      }
      if (data.status !== 'APPROVED') {
        denialReason = statusReason(data.status as string);
        return;
      }
      if (data.passNonce !== nonce) {
        denialReason = 'Token no longer valid';
        return;
      }
      if (data.date !== todayDateString()) {
        denialReason = 'Pass has expired';
        return;
      }

      const now = Timestamp.now();
      const auditRef = adminDb.collection('auditLogs').doc();
      tx.update(requestRef, { status: 'CHECKED_IN', checkedInBy: user.uid, checkedInAt: now });
      tx.set(auditRef, {
        logId: auditRef.id,
        action: 'CHECKED_IN',
        requestId,
        actorId: user.uid,
        actorRole: 'guard',
        targetEmployeeId: employeeId,
        timestamp: now,
        details: null,
      });
    });
  } catch (err) {
    console.error('Verification transaction failed', err);
    return NextResponse.json({ approved: false, reason: 'Server error — try again' });
  }

  if (denialReason) {
    await logDenial(user.uid, requestId, employeeId, denialReason);
    return NextResponse.json({ approved: false, reason: denialReason });
  }

  return NextResponse.json({ approved: true, employeeName, requestId });
}
