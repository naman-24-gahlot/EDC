import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';

// Deactivating an employee must actually revoke access, not just flip a display
// flag: disable the Firebase Auth account (blocks future sign-in) AND revoke its
// refresh tokens (invalidates any session cookie already issued — lib/session.ts's
// getSessionUser() calls verifySessionCookie with checkRevoked=true, so this takes
// effect on the employee's very next navigation).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
) {
  const admin = await getSessionUser();
  if (!admin) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (admin.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can deactivate employees' }, { status: 403 });
  }

  const { uid } = await params;
  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();

  if (!snap.exists || snap.data()?.role !== 'employee') {
    return NextResponse.json({ error: 'No employee account found for this id' }, { status: 404 });
  }
  if (snap.data()?.active === false) {
    return NextResponse.json({ error: 'Employee is already deactivated' }, { status: 409 });
  }

  try {
    await adminAuth.updateUser(uid, { disabled: true });
    await adminAuth.revokeRefreshTokens(uid);
  } catch (err) {
    console.error('Failed to disable employee auth account', err);
    return NextResponse.json({ error: 'Could not deactivate account' }, { status: 500 });
  }

  const now = Timestamp.now();
  const auditRef = adminDb.collection('auditLogs').doc();
  const batch = adminDb.batch();
  batch.update(userRef, { active: false });
  batch.set(auditRef, {
    logId: auditRef.id,
    action: 'EMPLOYEE_DEACTIVATED',
    requestId: null,
    actorId: admin.uid,
    actorRole: 'admin',
    targetEmployeeId: uid,
    timestamp: now,
    details: null,
  });
  await batch.commit();

  return NextResponse.json({ uid, active: false });
}
