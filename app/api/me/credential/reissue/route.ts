import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { reissueCredential } from '@/lib/access/credential';

// Self-service: kills every QR previously issued to the caller (lost phone, leaked screenshot).
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole === 'guard') return NextResponse.json({ error: 'Guards have no pass.' }, { status: 403 });

  try {
    return NextResponse.json(await reissueCredential(user, user.personId));
  } catch (err) {
    return errorResponse(err, 'Could not reissue the pass.');
  }
}
