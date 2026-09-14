import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { runRequestTransition } from '@/app/api/admin/_lib/request-transition';

function readNote(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const note = (body as { reviewNote?: unknown }).reviewNote;
  if (typeof note !== 'string') return null;
  const trimmed = note.trim().slice(0, 500);
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can revoke requests' }, { status: 403 });
  }

  const { requestId } = await params;
  const body = await request.json().catch(() => null);
  const reviewNote = readNote(body);

  return runRequestTransition({
    requestId,
    admin: user,
    fromStatuses: ['APPROVED'],
    toStatus: 'REVOKED',
    auditAction: 'REVOKED',
    auditDetails: reviewNote,
    // Clears the pass token — the moment status leaves APPROVED, any outstanding
    // QR/manual token for this request stops verifying (see SECURITY_MODEL.md).
    extraFields: () => ({ reviewNote, passNonce: null, passIssuedAt: null }),
  });
}
