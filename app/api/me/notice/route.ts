import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { audit, eventIdOf } from '@/lib/audit';

// Marks the signed-in person's own one-time approval notice as seen. Self only — no body,
// no target id. The notice itself is kept (with seenAt) as a record of what they were told.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const ref = adminDb.collection('people').doc(user.personId);
  await adminDb.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    const notice = data?.approvalNotice;
    if (!notice || notice.seenAt) return;
    const now = Timestamp.now();
    tx.update(ref, { 'approvalNotice.seenAt': now });
    audit(tx, { action: 'APPROVAL_NOTICE_SEEN', actor: user, targetPersonId: user.personId, eventId: eventIdOf(data), at: now, details: `told: applied as ${notice.appliedAs}, approved as ${notice.approvedAs}` });
  });
  return NextResponse.json({ ok: true });
}
