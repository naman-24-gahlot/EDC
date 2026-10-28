import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import {
  createRequest, listApprovalQueue, listRequestsFor, parseCreateRequest, type AccessRequest,
} from '@/lib/access/requests';

function view(r: AccessRequest) {
  return {
    id: r.id,
    personId: r.personId,
    requestedBy: r.requestedBy,
    purpose: r.purpose,
    requestedStartDate: r.requestedStartDate,
    requestedEndDate: r.requestedEndDate,
    status: r.status,
    createdAt: r.createdAt.toDate().toISOString(),
    actionableUntil: r.actionableUntil.toDate().toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: r.decidedAt?.toDate().toISOString() ?? null,
    decisionNote: r.decisionNote,
    resultingEntitlementId: r.resultingEntitlementId,
    expiredMarkedAt: r.expiredMarkedAt?.toDate().toISOString() ?? null,
  };
}

// { queue: PENDING requests I may decide, mine: my own requests (all statuses) }.
// Reading either lazily persists EXPIRED on anything past its 3-day window.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  // Gate staff have nobody under them and no requests of their own.
  if (user.systemRole === 'guard') return NextResponse.json({ error: 'Not available to guards.' }, { status: 403 });

  try {
    const [queue, mine] = await Promise.all([listApprovalQueue(user), listRequestsFor(user.personId)]);
    return NextResponse.json({ queue: queue.map(view), mine: mine.map(view) });
  } catch (err) {
    return errorResponse(err, 'Could not load requests.');
  }
}

// Body: { purpose, personId?, requestedStartDate?, requestedEndDate? } — personId omitted
// means "for myself"; otherwise the caller must be Master or an ancestor of that person.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const input = parseCreateRequest(user, await request.json().catch(() => null));
    return NextResponse.json(view(await createRequest(user, input)), { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not create request.');
  }
}
