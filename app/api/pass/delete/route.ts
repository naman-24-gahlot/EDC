import { NextRequest, NextResponse } from 'next/server';
import { parsePassToken, verifyPassSignature } from '@/lib/qr-token';
import { errorResponse, loadPerson } from '@/lib/hierarchy/authorize';
import { deleteAccount } from '@/lib/people/deleteAccount';

// "Delete my data" for event guests registered without a password: they have no account to sign
// in to, so their own pass link is what proves it's them — the same signed credential the gate
// checks, and only the CURRENT one (a replaced pass's old link can't). Body { token, confirm: "DELETE" }.
// Visitors are removed by their host, everyone else from their account (lib/people/deleteAccount.ts).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' && body.token.length <= 512 ? body.token : '';
  const parsed = parsePassToken(token);
  if (!parsed || !verifyPassSignature(parsed.personId, parsed.credentialVersion, parsed.signature)) {
    return NextResponse.json({ error: 'This isn’t a valid pass link.' }, { status: 403 });
  }
  try {
    const person = await loadPerson(parsed.personId);
    if (!person || person.credentialVersion !== parsed.credentialVersion || person.hasAccount !== false || person.profileType !== 'event_guest') {
      return NextResponse.json({ error: 'This pass can’t be used to delete data — ask the EDC office.' }, { status: 403 });
    }
    return NextResponse.json(await deleteAccount({ personId: person.personId, email: null, systemRole: 'member' }, person.personId, { confirm: body?.confirm }));
  } catch (err) {
    return errorResponse(err, 'Could not delete the data.');
  }
}
