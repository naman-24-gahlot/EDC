import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { reissueCredential } from '@/lib/access/credential';

// Kill every QR issued to this person. Master or an ancestor (self uses /api/me/credential/reissue).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  try {
    const { personId } = await params;
    if (personId === user.personId) {
      return NextResponse.json({ error: 'Use “Replace my QR code” on My account.' }, { status: 400 });
    }
    return NextResponse.json(await reissueCredential(user, personId));
  } catch (err) {
    return errorResponse(err, 'Could not reissue the pass.');
  }
}
