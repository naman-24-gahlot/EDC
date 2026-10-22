import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { parseEventInput, updateEvent, type EventCommand } from '@/lib/events';

const COMMANDS: EventCommand[] = ['close', 'reopen', 'new-link'];

// Master only. Body: any event fields to change, and/or { command: 'close' | 'reopen' | 'new-link' }.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole !== 'master') return NextResponse.json({ error: 'Only a Master can manage events.' }, { status: 403 }); // before reading the body
  try {
    const { eventId } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const command = COMMANDS.find((c) => c === body?.command) ?? null;
    const { command: _c, ...fields } = body ?? {}; // eslint-disable-line @typescript-eslint/no-unused-vars -- separating the command from the fields
    await updateEvent(user, eventId, parseEventInput(fields, true), command);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 'Could not update the event.');
  }
}
