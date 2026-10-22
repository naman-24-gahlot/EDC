import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { createEvent, parseEventInput } from '@/lib/events';

// Master only. Body: { name, details, venue, accessFrom, accessTo, gateOpens, gateCloses, linkExpiresAt (ISO) }.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole !== 'master') return NextResponse.json({ error: 'Only a Master can manage events.' }, { status: 403 }); // before reading the body
  try {
    const event = await createEvent(user, parseEventInput(await request.json().catch(() => null), false));
    return NextResponse.json({ id: event.id }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not create the event.');
  }
}
