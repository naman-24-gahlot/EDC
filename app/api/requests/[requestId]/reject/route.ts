import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { rejectRequest } from '@/lib/access/requests';

// Body: optional { note }.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { requestId } = await params;
    const body = await request.json().catch(() => null);
    const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
    return NextResponse.json(await rejectRequest(user, requestId, note));
  } catch (err) {
    return errorResponse(err, 'Could not reject request.');
  }
}
