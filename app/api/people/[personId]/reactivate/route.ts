import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { setActive } from '@/lib/people/activation';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { personId } = await params;
    return NextResponse.json(await setActive(user, personId, true));
  } catch (err) {
    return errorResponse(err, 'Could not reactivate.');
  }
}
