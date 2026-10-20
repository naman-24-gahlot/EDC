import { NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE_NAME } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { signOutEverywhere } from '@/lib/people/profile';

// Sign out of every device, this one included (e.g. a phone was lost).
export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    await signOutEverywhere(user);
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE_NAME);
    return res;
  } catch (err) {
    return errorResponse(err, 'Could not sign out everywhere.');
  }
}
