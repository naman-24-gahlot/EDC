import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';

// Marks the signed-in person's own one-time approval notice as seen. Self only — no body,
// no target id. The notice itself is kept (with seenAt) as a record of what they were told.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const ref = adminDb.collection('people').doc(user.personId);
  await adminDb.runTransaction(async (tx) => {
    const notice = (await tx.get(ref)).data()?.approvalNotice;
    if (notice && !notice.seenAt) tx.update(ref, { 'approvalNotice.seenAt': Timestamp.now() });
  });
  return NextResponse.json({ ok: true });
}
