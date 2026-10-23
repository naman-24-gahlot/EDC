import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { sendEmailVerification } from '@/lib/auth/emailActions';
import { siteOrigin } from '@/lib/origin';

// Signed-in person: (re)send the link that verifies their own email. Rate limited per IP.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    await sendEmailVerification(user.personId, await siteOrigin());
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Verification email failed', err);
    return NextResponse.json({ error: 'Could not send the email right now. Try again in a few minutes.' }, { status: 503 });
  }
}
