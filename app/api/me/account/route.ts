import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, SESSION_COOKIE_NAME } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { deleteAccount } from '@/lib/people/deleteAccount';

// Delete your own account permanently: body { password, confirm: "DELETE" } (lib/people/deleteAccount.ts).
export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const body = await request.json().catch(() => null);
  try {
    const result = await deleteAccount(user, user.personId, { password: body?.password, confirm: body?.confirm });
    const response = NextResponse.json(result);
    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  } catch (err) {
    return errorResponse(err, 'Could not delete the account.');
  }
}
