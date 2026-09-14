import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}

// Creates a temporary employee account: Firebase Auth user + 'employee' custom claim
// + Firestore users/{uid} doc, all provisioned by an admin (no self-registration, no
// email/SMS invite per CLAUDE.md's out-of-scope list). The generated password is
// returned once in the response for the admin to relay out-of-band.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can add employees' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : '';

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  }
  if (displayName.length === 0 || displayName.length > 100) {
    return NextResponse.json({ error: 'A display name (1-100 chars) is required' }, { status: 400 });
  }

  const password = generatePassword();

  let uid: string;
  try {
    const created = await adminAuth.createUser({
      email,
      password,
      displayName,
      emailVerified: true,
    });
    uid = created.uid;
  } catch (err) {
    const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
    if (code === 'auth/email-already-exists') {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }
    console.error('Failed to create employee auth account', err);
    return NextResponse.json({ error: 'Could not create employee account' }, { status: 500 });
  }

  await adminAuth.setCustomUserClaims(uid, { role: 'employee' });

  const now = Timestamp.now();
  const auditRef = adminDb.collection('auditLogs').doc();
  const batch = adminDb.batch();
  batch.set(adminDb.collection('users').doc(uid), {
    uid,
    email,
    displayName,
    role: 'employee',
    active: true,
    createdAt: now,
    createdBy: user.uid,
  });
  batch.set(auditRef, {
    logId: auditRef.id,
    action: 'EMPLOYEE_ADDED',
    requestId: null,
    actorId: user.uid,
    actorRole: 'admin',
    targetEmployeeId: uid,
    timestamp: now,
    details: null,
  });

  try {
    await batch.commit();
  } catch (err) {
    console.error('Employee auth account created but Firestore write failed', err);
    return NextResponse.json(
      { error: 'Account created but failed to save profile — check Firebase console' },
      { status: 500 }
    );
  }

  return NextResponse.json({ uid, email, displayName, password }, { status: 201 });
}
