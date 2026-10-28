import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { onCampusNow } from '@/lib/gate';

// "On campus now" list, fetched when the guard opens it (the screen itself shows only counts).
// Guards and Masters: both see everyone inside on their own pages already.
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  if (user.systemRole !== 'guard' && user.systemRole !== 'master') return NextResponse.json({ error: 'Not authorized.' }, { status: 403 });
  return NextResponse.json({ people: await onCampusNow(), fetchedAt: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
}
