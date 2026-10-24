import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { parseLeaveInput, requestLeave } from '@/lib/leave';

// An employee asks for leave for themselves: { startDate, endDate, reason }.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    return NextResponse.json(await requestLeave(user, parseLeaveInput(await request.json().catch(() => null))), { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not send the leave request.');
  }
}
