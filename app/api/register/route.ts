import { NextRequest, NextResponse } from 'next/server';
import { assertGoodPassword } from '@/lib/auth/passwordPolicy';
import { consumeEmailCheck, isEmailConfirmed } from '@/lib/emailCheck';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { humanCheckPassed } from '@/lib/turnstile';
import { clientIpFrom } from '@/lib/rateLimit';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { createPerson, PersonCreateError } from '@/lib/people/create';
import { resolveEmployeeParent } from '@/lib/people/resolveParent';
import { isProfileType, SUBORDINATE_PROFILE_TYPES } from '@/lib/access/codes';
import { eventByToken, linkState, parseSource } from '@/lib/events';
import { audit } from '@/lib/audit';
import { parseBackupEmail } from '@/lib/people/profile';

// Public, unauthenticated. Can only ever create a PENDING person — approval is the
// real gate, so the general link needs no invite token. See SECURITY_MODEL.md
// "Registration and approval authority". With { eventToken } (an event's link) the
// registration is tagged with that event and refused once the link has expired or closed;
// a controlling employee is optional then (approval places dependants under the approver).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  const username = typeof body.username === 'string' ? body.username : '';
  const commEmail = typeof body.commEmail === 'string' ? body.commEmail.trim() : '';
  const mobile = typeof body.mobile === 'string' ? body.mobile.trim() : '';
  const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  // Event links register guests only — the type is fixed here, whatever the form sent; a Master
  // can approve them as another type, or change it later.
  const profileType = body.eventToken !== undefined ? 'event_guest' : body.profileType;
  const parentIdentifier =
    typeof body.parentIdentifier === 'string' ? body.parentIdentifier.trim() : '';
  const photoDataUrl = typeof body.photoDataUrl === 'string' ? body.photoDataUrl : null;
  let backupEmail: string | null;
  try { backupEmail = parseBackupEmail(body.backupEmail); } catch (err) { return errorResponse(err); }
  if (backupEmail && backupEmail === commEmail.toLowerCase()) {
    return NextResponse.json({ error: 'The backup email must be different from your main email.' }, { status: 400 });
  }

  if (!(await humanCheckPassed(body.humanToken, clientIpFrom(request.headers)))) {
    return NextResponse.json({ error: 'Please complete the “I’m human” check and try again.' }, { status: 400 });
  }
  if (!firstName || !lastName || !mobile || !purpose) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }
  if (!isProfileType(profileType)) {
    return NextResponse.json({ error: 'Invalid profile type.' }, { status: 400 });
  }

  const event = body.eventToken === undefined ? null : await eventByToken(body.eventToken);
  if (body.eventToken !== undefined) {
    if (!event) return NextResponse.json({ error: 'This event link is not valid.' }, { status: 404 });
    const state = linkState(event);
    if (state !== 'OPEN') {
      return NextResponse.json({ error: `Registration for ${event.name} is ${state === 'CLOSED' ? 'closed' : 'over — the link has expired'}.` }, { status: 410 });
    }
  }

  let parentId: string | null = null;
  if (SUBORDINATE_PROFILE_TYPES.includes(profileType) && !(event && !parentIdentifier)) {
    if (!parentIdentifier) {
      return NextResponse.json(
        {
          error:
            "This profile type needs your controlling employee's username or access code.",
        },
        { status: 400 }
      );
    }
    parentId = await resolveEmployeeParent(parentIdentifier);
    if (!parentId) {
      return NextResponse.json(
        { error: 'Could not find an approved, active employee with that username or access code.' },
        { status: 400 }
      );
    }
  }

  // The email must have been confirmed from the form first (lib/emailCheck.ts).
  if (!(await isEmailConfirmed(commEmail))) {
    return NextResponse.json({ error: 'Confirm your email first: press “Send confirmation link” next to the email box and open the link we send.' }, { status: 400 });
  }
  try {
    await assertGoodPassword(password, { username, email: commEmail, name: `${firstName} ${lastName}` });
  } catch (err) {
    return errorResponse(err);
  }

  let created;
  try {
    created = await createPerson(
      { firstName, lastName, username, commEmail, mobile, purpose, profileType, password, photoDataUrl },
      {
        createdBy: 'self', parentId, registrationStatus: 'PENDING',
        ...(event ? { event: { eventId: event.id, eventName: event.name, source: parseSource(body.source) } } : {}),
      }
    );
  } catch (err) {
    if (err instanceof PersonCreateError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('Registration failed', err);
    return NextResponse.json({ error: 'Could not complete registration.' }, { status: 500 });
  }

  await audit(null, {
    action: 'REGISTRATION_SUBMITTED', actor: 'public', targetPersonId: created.personId, eventId: event?.id ?? null,
    details: `profileType=${profileType}${event ? `; event: ${event.name}` : ''}`,
  });

  // Confirmed before registering: the account starts confirmed, and the confirmation is used up.
  await Promise.all([
    adminAuth.updateUser(created.personId, { emailVerified: true }),
    adminDb.collection('people').doc(created.personId).update({ emailVerified: true, ...(backupEmail ? { backupEmail } : {}) }),
    consumeEmailCheck(commEmail),
  ]);
  return NextResponse.json({ personId: created.personId }, { status: 201 });
}
