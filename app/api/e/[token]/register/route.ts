import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { eventByToken, eventOptions, linkState } from '@/lib/events';
import { parseQuickInput, registerQuickGuest } from '@/lib/eventGuests';
import { humanCheckPassed } from '@/lib/turnstile';
import { clientIpFrom } from '@/lib/rateLimit';
import { siteOrigin } from '@/lib/origin';

// Public: quick sign-up (no password, no account) on an event link whose options allow it
// (lib/eventGuests.ts). Rate limited per IP in proxy.ts with a kiosk-sized budget.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const event = await eventByToken((await params).token);
  if (!event || linkState(event) !== 'OPEN') return NextResponse.json({ error: 'Registration for this event is closed.' }, { status: 410 });
  if (eventOptions(event).requirePassword) return NextResponse.json({ error: 'This event needs a full registration.' }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!(await humanCheckPassed(body?.humanToken, clientIpFrom(request.headers)))) {
    return NextResponse.json({ error: 'Please complete the “I’m human” check and try again.' }, { status: 400 });
  }
  try {
    const opts = eventOptions(event);
    const result = await registerQuickGuest(event, parseQuickInput(body), await siteOrigin());
    return NextResponse.json({ ...result, print: opts.print, cardSize: opts.cardSize, kiosk: opts.kiosk, kioskNext: opts.kioskNext, kioskSeconds: opts.kioskSeconds }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not register you — please try again.');
  }
}
