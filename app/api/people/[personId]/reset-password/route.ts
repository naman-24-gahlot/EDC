import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { resetPassword } from '@/lib/people/profile';

// Master only, never self. Returns a one-time password, shown once; the person is signed out everywhere.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const { personId } = await params;
    return NextResponse.json({ password: await resetPassword(user, personId) });
  } catch (err) {
    return errorResponse(err, 'Could not reset the password.');
  }
}
