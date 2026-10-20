import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { parseProfilePatch, updateProfile } from '@/lib/people/profile';

// Edit your own name, mobile, purpose or photo.
export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const patch = parseProfilePatch(await request.json().catch(() => null));
    return NextResponse.json(await updateProfile(user, user.personId, patch));
  } catch (err) {
    return errorResponse(err, 'Could not update your profile.');
  }
}
