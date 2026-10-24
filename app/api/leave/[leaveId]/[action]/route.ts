import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { cancelLeave, decideLeave } from '@/lib/leave';

// POST /api/leave/{id}/approve | reject  — Master or anyone the employee is under; body { note? }
// POST /api/leave/{id}/cancel            — the employee themselves
export async function POST(request: NextRequest, { params }: { params: Promise<{ leaveId: string; action: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { leaveId, action } = await params;
  const body = await request.json().catch(() => null);
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 200) : null;
  try {
    if (action === 'approve' || action === 'reject') return NextResponse.json(await decideLeave(user, leaveId, action === 'approve', note));
    if (action === 'cancel') return NextResponse.json(await cancelLeave(user, leaveId));
    return NextResponse.json({ error: 'Unknown action.' }, { status: 404 });
  } catch (err) {
    return errorResponse(err, 'Could not update the leave request.');
  }
}
