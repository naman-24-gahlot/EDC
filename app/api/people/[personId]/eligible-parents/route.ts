import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { getSessionUser } from '@/lib/session';
import { errorResponse, requireMaster } from '@/lib/hierarchy/authorize';

// Master only. The employees this person could be moved under — fetched when the Master opens
// "Change parent" on the person page, instead of on every view of it. Convenience only: the
// server re-checks every rule when the move is made (lib/hierarchy/rehome.ts).
export async function GET(_request: Request, { params }: { params: Promise<{ personId: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  try {
    requireMaster(user);
    const { personId } = await params;
    if (!/^[A-Za-z0-9]{1,128}$/.test(personId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const [employees, descendants] = await Promise.all([
      adminDb.collection('people').where('profileType', '==', 'employee').select('firstName', 'lastName', 'systemRole', 'registrationStatus', 'active').get(),
      adminDb.collection('people').where('ancestorIds', 'array-contains', personId).select().get(),
    ]);
    const below = new Set(descendants.docs.map((d) => d.id));
    const parents = employees.docs
      .filter((d) => d.id !== personId && d.get('registrationStatus') === 'APPROVED' && d.get('active') === true && !below.has(d.id))
      .map((d) => ({ id: d.id, name: `${d.get('firstName')} ${d.get('lastName')}${d.get('systemRole') === 'master' ? ' (Master)' : ''}` }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return NextResponse.json({ parents }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return errorResponse(err, 'Could not load the employees.');
  }
}
