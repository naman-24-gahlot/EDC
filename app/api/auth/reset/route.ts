import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { completeEmailReset } from '@/lib/people/profile';

// Public: the link itself is the proof. Body: { oobCode, newPassword }. Signs the account out
// everywhere; they then sign in with the new password.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    await completeEmailReset(body?.oobCode, body?.newPassword);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, 'Could not set your password.');
  }
}
