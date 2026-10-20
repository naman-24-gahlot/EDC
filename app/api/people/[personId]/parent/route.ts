import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { rehome } from '@/lib/hierarchy/rehome';

// Body: { parentId: string | null } — null moves the person to top-level.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parentId = body?.parentId;
  if (parentId !== null && (typeof parentId !== 'string' || !parentId || parentId.includes('/'))) {
    return NextResponse.json({ error: 'parentId must be a person id or null.' }, { status: 400 });
  }

  try {
    const { personId } = await params;
    return NextResponse.json({ personId, ...(await rehome(user, personId, parentId)) });
  } catch (err) {
    return errorResponse(err, 'Could not change parent.');
  }
}
