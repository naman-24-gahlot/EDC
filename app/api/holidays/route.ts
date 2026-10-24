import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { addHoliday, parseHolidayInput } from '@/lib/holidays';

// Master adds a campus holiday: { date, name, appliesTo: profileType[] }.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    return NextResponse.json(await addHoliday(user, parseHolidayInput(await request.json().catch(() => null))), { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not add the holiday.');
  }
}
