import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/session';
import { errorResponse } from '@/lib/hierarchy/authorize';
import { cardDataFor, printablePerson } from '@/lib/passData';
import { passLayout, isCardSize, DEFAULT_CARD_SIZE } from '@/lib/passCard';
import { passPdf } from '@/lib/passPdf';

// GET /api/pass/pdf?person=<id>&size=cr80  — the person, anyone they're under, or a Master
// GET /api/pass/pdf?t=<pass link token>&size=…  — whoever holds the pass link (kiosks, visitors)
// A PDF exactly the card's size (or an A4 page with cut marks), to print or keep.
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const size = isCardSize(sp.get('size')) ? sp.get('size') as Parameters<typeof passLayout>[1] : DEFAULT_CARD_SIZE;
  try {
    const user = sp.get('t') ? null : await getSessionUser();
    const person = await printablePerson({ user, personId: sp.get('person'), token: sp.get('t') });
    const pdf = passPdf([passLayout(await cardDataFor(person), size)], `EDC pass — ${person.firstName} ${person.lastName}`);
    const file = `edc-pass-${`${person.firstName}-${person.lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${size}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${sp.get('inline') ? 'inline' : 'attachment'}; filename="${file}"`, 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    return errorResponse(err, 'Could not make the PDF.');
  }
}
