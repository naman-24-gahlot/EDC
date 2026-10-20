import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { editEntitlement, parseWindowPatch } from '@/lib/access/entitlements';

// Edit an ACTIVE entitlement's window. Master or an ancestor of the person.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ entitlementId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { entitlementId } = await params;
    const body = await request.json().catch(() => null);
    return NextResponse.json(await editEntitlement(user, entitlementId, parseWindowPatch(body)));
  } catch (err) {
    return errorResponse(err, 'Could not update access.');
  }
}
