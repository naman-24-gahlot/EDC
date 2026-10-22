import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSessionUser } from '@/lib/session';
import { errorResponse, requireMaster } from '@/lib/hierarchy/authorize';
import { createPerson } from '@/lib/people/create';
import { audit } from '@/lib/audit';

// Master only. Guard = system role, not a profile type: profileType null, top-level,
// approved on creation, no access code. Body: { firstName, lastName, username, commEmail, mobile }.
export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    requireMaster(user);
    const body = await request.json().catch(() => null);
    const str = (k: string) => (typeof body?.[k] === 'string' ? body[k].trim() : '');
    if (!str('firstName') || !str('lastName') || !str('mobile')) {
      return NextResponse.json({ error: 'First name, last name and mobile are required.' }, { status: 400 });
    }
    const password = randomBytes(9).toString('base64url');
    const created = await createPerson(
      {
        firstName: str('firstName'), lastName: str('lastName'), username: str('username'), commEmail: str('commEmail'),
        mobile: str('mobile'), purpose: 'Gate security', profileType: null, password, photoDataUrl: null,
      },
      { createdBy: user.personId, parentId: null, registrationStatus: 'APPROVED', systemRole: 'guard' }
    );
    await audit(null, { action: 'GUARD_CREATED', actor: user, targetPersonId: created.personId });
    return NextResponse.json({ personId: created.personId, username: created.username, password }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'Could not create guard.');
  }
}
