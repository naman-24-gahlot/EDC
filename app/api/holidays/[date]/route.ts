import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { removeHoliday } from '@/lib/holidays';

// Master removes a holiday (the audit log keeps that it existed).
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    return NextResponse.json(await removeHoliday(user, (await params).date));
  } catch (err) {
    return errorResponse(err, 'Could not remove the holiday.');
  }
}
