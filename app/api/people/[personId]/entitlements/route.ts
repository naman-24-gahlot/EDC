import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { todayDateString } from '@/lib/date';
import { assertCanActOn, errorResponse } from '@/lib/hierarchy/authorize';
import { effectiveStatus, grantEntitlement, listEntitlements, parseWindowPatch } from '@/lib/access/entitlements';

// Reading your OWN entitlements isn't acting on another person; anyone else needs assertCanActOn.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { personId } = await params;
    if (personId !== user.personId) await assertCanActOn(user, personId);
    const today = todayDateString();
    const entitlements = (await listEntitlements(personId)).map((e) => ({
      id: e.id,
      profileTypeAtGrant: e.profileTypeAtGrant,
      startDate: e.startDate,
      endDate: e.endDate,
      weekdays: e.weekdays,
      startTime: e.startTime,
      endTime: e.endTime,
      state: e.state,
      effectiveStatus: effectiveStatus(e, today),
      sourceRequestId: e.sourceRequestId,
      approvedBy: e.approvedBy,
      approvedAt: e.approvedAt.toDate().toISOString(),
      revokeReason: e.revokeReason,
    }));
    return NextResponse.json({ entitlements });
  } catch (err) {
    return errorResponse(err, 'Could not load entitlements.');
  }
}

// Direct grant by Master or an ancestor. Body: optional { startDate, endDate, weekdays,
// startTime, endTime } overriding the person's profile-type template.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { personId } = await params;
    const body = await request.json().catch(() => ({}));
    const overrides = parseWindowPatch(body);
    const granted = await grantEntitlement(user, { personId, sourceRequestId: null, overrides });
    return NextResponse.json(granted, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not grant access.');
  }
}
