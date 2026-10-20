import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { parseWindowPatch } from '@/lib/access/entitlements';
import { approveRequest } from '@/lib/access/requests';

// Body: optional { note, startDate, endDate, weekdays, startTime, endTime } — window
// fields override the request's dates and the profile-type template.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { requestId } = await params;
    const body = await request.json().catch(() => ({}));
    const { note, ...window } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
    return NextResponse.json(await approveRequest(user, requestId, parseWindowPatch(window), cleanNote));
  } catch (err) {
    return errorResponse(err, 'Could not approve request.');
  }
}
