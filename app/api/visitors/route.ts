import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { siteOrigin } from '@/lib/origin';
import { createVisitor, parseVisitorInput } from '@/lib/visitors';

// An active employee or a Master creates a visitor pass (lib/visitors.ts). Returns the pass link
// to share; it is also emailed when the visitor's email is given.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const input = parseVisitorInput(await request.json().catch(() => null));
    return NextResponse.json(await createVisitor(user, input, await siteOrigin()), { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not create the visitor pass.');
  }
}
