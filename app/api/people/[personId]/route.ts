import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { accessCodeFor } from '@/lib/access/codes';
import { assertCanActOn, errorResponse } from '@/lib/hierarchy/authorize';
import { parseProfilePatch, updateProfile } from '@/lib/people/profile';

// Edit someone's name, mobile, purpose or photo — Master or an ancestor (updateProfile checks).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const { personId } = await params;
    const patch = parseProfilePatch(await request.json().catch(() => null));
    return NextResponse.json(await updateProfile(user, personId, patch));
  } catch (err) {
    return errorResponse(err, 'Could not update the profile.');
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { personId } = await params;
    const p = await assertCanActOn(user, personId);
    return NextResponse.json({
      personId: p.personId,
      firstName: p.firstName,
      lastName: p.lastName,
      username: p.username,
      commEmail: p.commEmail ?? null,
      mobile: p.mobile ?? null,
      photoDataUrl: p.photoDataUrl ?? null,
      purpose: p.purpose ?? null,
      profileType: p.profileType,
      systemRole: p.systemRole,
      parentId: p.parentId,
      registrationStatus: p.registrationStatus,
      active: p.active,
      accessCode: accessCodeFor(p.profileType, p.accessNumber),
    });
  } catch (err) {
    return errorResponse(err, 'Could not load person.');
  }
}
