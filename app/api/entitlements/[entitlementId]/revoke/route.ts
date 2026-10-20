import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { revokeEntitlement } from '@/lib/access/entitlements';

// Body: optional { reason }. Master or an ancestor of the person.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ entitlementId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { entitlementId } = await params;
    const body = await request.json().catch(() => null);
    const raw = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    return NextResponse.json(await revokeEntitlement(user, entitlementId, raw || null));
  } catch (err) {
    return errorResponse(err, 'Could not revoke access.');
  }
}
