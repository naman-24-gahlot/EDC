import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { setTestMode, testModeOn } from '@/lib/testMode';

// GET (public): { testMode } — the forms use it to relax fields and skip Turnstile while testing.
// PATCH (Master only): { testMode: boolean } — the switch on /admin. See lib/testMode.ts.
export async function GET() {
  return NextResponse.json({ testMode: await testModeOn() }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    return NextResponse.json(await setTestMode(user, body?.testMode));
  } catch (err) {
    return errorResponse(err, 'Could not change testing mode.');
  }
}
