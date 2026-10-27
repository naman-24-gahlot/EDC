import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { getSessionUser } from '@/lib/session';
import { HttpError } from '@/lib/hierarchy/authorize';
import { cardDataFor, printablePerson } from '@/lib/passData';
import { CARD_SIZES, DEFAULT_CARD_SIZE, cardSize, isCardSize, passLayout, type CardSizeId } from '@/lib/passCard';
import { PassCardSvg } from '@/components/PassCardSvg';
import { PrintControls } from './PrintControls';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Print entry pass — EDC', robots: { index: false, follow: false } };

type Q = { person?: string; t?: string; size?: string; auto?: string; next?: string };

// Print (or save as PDF) an entry pass at a real card size. Opened by the person, anyone they're
// under or a Master (?person=<id>), or with the pass link's token (?t=…, kiosks and visitors).
// On paper only the card prints; @page is set to the card's exact size with no margins.
export default async function PrintPassPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const sizeId: CardSizeId = isCardSize(q.size) ? q.size : DEFAULT_CARD_SIZE;
  const size = cardSize(sizeId);
  const user = q.t ? null : await getSessionUser();
  if (!q.t && !user) redirect('/login');

  let person;
  try {
    person = await printablePerson({ user, personId: q.person, token: q.t });
  } catch (err) {
    return <main className="mx-auto max-w-sm px-4 py-16 text-center text-sm text-gray-600">{err instanceof HttpError ? err.message : 'This pass can’t be printed.'}</main>;
  }
  const layout = passLayout(await cardDataFor(person), sizeId);
  // Only our own pages may follow a kiosk print (no open redirect).
  const next = typeof q.next === 'string' && /^\/e\/[A-Za-z0-9_-]{16}(\?.*)?$/.test(q.next) ? q.next : null;
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (q.t) p.set('t', q.t); else if (q.person) p.set('person', q.person);
    if (next) p.set('next', next);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p.toString();
  };
  const pdfHref = `/api/pass/pdf?${keep({ size: sizeId })}`;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 print:m-0 print:max-w-none print:p-0">
      <style>{`@page { size: ${size.w}mm ${size.h}mm; margin: 0 } @media print { html, body { margin: 0 !important; padding: 0 !important; height: auto !important; min-height: 0 !important; background: #fff !important; } }`}</style>
      <div className="space-y-1 print:hidden">
        {!q.t && <Link href={person.personId === user?.personId ? '/me/pass' : '/me'} className="inline-flex min-h-10 items-center text-sm text-[#0D5B7A] underline md:min-h-0">← Back</Link>}
        <h1 className="text-xl font-bold">Print entry pass — {person.firstName} {person.lastName}</h1>
        <p className="text-sm text-gray-600">Pick a size, then Print (or Download PDF). On the printer: <b>actual size / 100%</b>, no margins, and the matching paper (card printers: CR80).</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 print:hidden" role="group" aria-label="Card size">
        {CARD_SIZES.map((s) => (
          <Link key={s.id} href={`/print/pass?${keep({ size: s.id, ...(q.auto ? { auto: q.auto } : {}) })}`} aria-pressed={s.id === sizeId} data-size={s.id}
            className={`rounded-lg border p-2 text-left text-xs ${s.id === sizeId ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-800'}`}>
            <b className="block text-sm">{s.label}</b>{s.note}
          </Link>
        ))}
      </div>
      <PrintControls auto={q.auto === '1'} next={next} pdfHref={pdfHref} />
      {!layout.shapes.some((s) => s.kind === 'qr') && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 print:hidden">No QR on this card: there’s no access in force right now. The access code still works at the gate once access is granted.</p>}
      <div className="overflow-x-auto rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 print:overflow-visible print:border-0 print:bg-white print:p-0" data-testid="pass-preview">
        <PassCardSvg w={layout.w} h={layout.h} shapes={layout.shapes} className="mx-auto block h-auto max-w-full shadow print:max-w-none print:shadow-none" />
      </div>
      <p className="text-xs text-gray-500 print:hidden">The QR is their live pass: replacing their QR, revoking or switching off their access makes printed cards stop working at the gate — print a new one.</p>
    </main>
  );
}
