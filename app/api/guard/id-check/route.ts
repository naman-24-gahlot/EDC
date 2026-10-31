import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { audit } from '@/lib/audit';

import { ID_TYPES } from '@/lib/idCheck';
import { personTouched } from '@/lib/people/peopleIndex';
const RECENT_MS = 10 * 60_000;

// Guard only. Body: { entryId, type, last4? }. Records that a photo ID was looked at, against an
// entry this guard approved in the last 10 minutes — so a guard can only mark someone standing in
// front of them. Stores the ID type and at most its last 4 characters; never a number or an image.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole !== 'guard') return NextResponse.json({ error: 'Guards only.' }, { status: 403 });
  const body = await request.json().catch(() => null);
  const type = ID_TYPES.find((t) => t === body?.type);
  const last4 = typeof body?.last4 === 'string' && body.last4.trim() ? body.last4.trim().toUpperCase() : null;
  if (!type) return NextResponse.json({ error: 'Choose the kind of ID.' }, { status: 400 });
  if (last4 !== null && !/^[A-Z0-9]{4}$/.test(last4)) return NextResponse.json({ error: 'Last 4 characters only (letters or digits) — never the full number.' }, { status: 400 });
  if (typeof body?.entryId !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(body.entryId)) return NextResponse.json({ error: 'Scan the person first.' }, { status: 400 });

  const entry = (await adminDb.collection('entryEvents').doc(body.entryId).get()).data();
  if (!entry || entry.guardUid !== user.personId || entry.result !== 'APPROVED' || !entry.personId || Date.now() - entry.timestamp.toMillis() > RECENT_MS) {
    return NextResponse.json({ error: 'Scan the person again, then record their ID.' }, { status: 409 });
  }
  const now = Timestamp.now();
  const batch = adminDb.batch();
  batch.update(adminDb.collection('people').doc(entry.personId), { idCheck: { type, last4, by: user.personId, at: now, entryId: body.entryId }, ...personTouched() });
  audit(batch, { action: 'ID_CHECKED', actor: user, targetPersonId: entry.personId, subjectId: body.entryId, eventId: entry.eventId ?? null, at: now, details: `${type}${last4 ? ` ending ${last4}` : ''}` });
  await batch.commit();
  return NextResponse.json({ ok: true });
}
