import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { rejectRegistration } from '@/lib/people/approveRegistration';

// Master, or the person's ancestor. Body: optional { note }.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  try {
    const { personId } = await params;
    return NextResponse.json(await rejectRegistration(user, personId, note));
  } catch (err) {
    return errorResponse(err, 'Could not reject the registration.');
  }
}
