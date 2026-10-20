import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { isProfileType } from '@/lib/access/codes';
import { changeProfileType } from '@/lib/people/profileType';

// Master only. Body: { profileType }.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!isProfileType(body?.profileType)) {
    return NextResponse.json({ error: 'profileType must be one of the six profile types.' }, { status: 400 });
  }
  try {
    const { personId } = await params;
    return NextResponse.json(await changeProfileType(user, personId, body.profileType));
  } catch (err) {
    return errorResponse(err, 'Could not change profile type.');
  }
}
