import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { isProfileType } from '@/lib/access/codes';
import { approveRegistration } from '@/lib/people/approveRegistration';

// Master, or the person's parent employee. Body: optional { profileType } to approve them under
// a different type than they applied for. Grants that type's default access at once.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const type = body?.profileType;
  if (type !== undefined && !isProfileType(type)) {
    return NextResponse.json({ error: 'profileType must be one of the six profile types.' }, { status: 400 });
  }
  try {
    const { personId } = await params;
    return NextResponse.json(await approveRegistration(user, personId, type));
  } catch (err) {
    return errorResponse(err, 'Could not approve the registration.');
  }
}
