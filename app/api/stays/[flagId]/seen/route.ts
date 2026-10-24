import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { markFlagSeen } from '@/lib/stays';

// A stay alert (late exit / overnight / no exit scan) marked as seen — Master, or anyone the
// person is under (assertCanActOn). The person themselves can't clear their own alerts.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ flagId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    return NextResponse.json(await markFlagSeen(user, (await params).flagId));
  } catch (err) {
    return errorResponse(err, 'Could not update the alert.');
  }
}
