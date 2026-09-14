import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSessionUser } from '@/lib/session';
import { runRequestTransition } from '@/app/api/admin/_lib/request-transition';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can approve requests' }, { status: 403 });
  }

  const { requestId } = await params;

  return runRequestTransition({
    requestId,
    admin: user,
    fromStatuses: ['PENDING'],
    toStatus: 'APPROVED',
    auditAction: 'APPROVED',
    extraFields: (_data, now) => ({
      passNonce: randomBytes(16).toString('hex'),
      passIssuedAt: now,
    }),
  });
}
