import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { LIST_FIELDS, errorResponse, requireMaster, toPerson } from '@/lib/hierarchy/authorize';
import { byName, treeNode } from '@/lib/hierarchy/treeNode';

// Master only. ?parent=<personId> → the people directly under them, for the hierarchy page's
// branches (opened one at a time instead of reading everyone on every visit).
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    requireMaster(user);
    const parent = request.nextUrl.searchParams.get('parent') ?? '';
    if (!/^[A-Za-z0-9]{1,128}$/.test(parent)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const snap = await adminDb.collection('people').where('parentId', '==', parent).select(...LIST_FIELDS).get();
    return NextResponse.json({ kids: snap.docs.map((d) => toPerson(d)!).sort(byName).map(treeNode) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err, 'Could not load that branch.');
  }
}
