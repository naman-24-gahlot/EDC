import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { decideMany, parseDecisionBody } from '@/lib/decisions';

// Up to 100 decisions, one after another (each its own transaction).
export const maxDuration = 60;

// Bulk approve/reject. Body: { kind: 'registration' | 'request', action: 'approve' | 'reject',
// ids: string[] (≤100), note?, profileType? }. Authority is checked per item, as for one click.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const { kind, action, ids, options } = parseDecisionBody(await request.json().catch(() => null));
    const results = await decideMany(user, kind, action, ids, options);
    const done = results.filter((r) => r.ok).length;
    return NextResponse.json({ results, done, failed: results.length - done });
  } catch (err) {
    return errorResponse(err, 'Could not process these decisions.');
  }
}
