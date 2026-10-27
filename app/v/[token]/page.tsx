import QRCode from 'qrcode';
import type { Metadata } from 'next';
import { nowInIST } from '@/lib/date';
import { parsePassToken, verifyPassSignature } from '@/lib/qr-token';
import { loadPerson } from '@/lib/hierarchy/authorize';
import { accessCodeFor } from '@/lib/access/codes';
import { getCurrentEntitlement } from '@/lib/access/entitlements';
import { evaluateAccess } from '@/lib/access/evaluate';
import { windowSummary } from '@/lib/display';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Visitor pass — EDC', robots: { index: false, follow: false } };

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-2 rounded-lg border border-gray-200 p-6 text-sm text-gray-700">
        <h1 className="text-lg font-semibold text-gray-900">{title}</h1>{children}
      </div>
    </main>
  );
}

// A pass with no sign-in — visitors, and event guests registered without a password: the link
// carries the same signed credential the gate checks, so only someone holding the link can show it.
// (Anyone with an account can also be sent one; it's the same credential as their own pass.) Others use
// their own account's pass. A replaced/revoked/ended pass says so instead of showing a QR.
export default async function VisitorPassPage({ params }: { params: Promise<{ token: string }> }) {
  const raw = (await params).token;
  const token = (() => { try { return decodeURIComponent(raw); } catch { return ''; } })(); // a malformed link is just "not a pass"
  const parsed = parsePassToken(token);
  const valid = parsed && verifyPassSignature(parsed.personId, parsed.credentialVersion, parsed.signature);
  const person = valid ? await loadPerson(parsed.personId) : null;
  if (!person || !person.profileType) return <Box title="This isn’t an EDC pass">Check that you opened the whole link from your email or message.</Box>;
  if (person.credentialVersion !== parsed!.credentialVersion) return <Box title="This pass was replaced">Ask your host for the new link.</Box>;

  const [entitlement, verdict, host] = await Promise.all([
    getCurrentEntitlement(person.personId), evaluateAccess(person, nowInIST()), typeof person.hostId === 'string' ? loadPerson(person.hostId) : null,
  ]);
  const ended = !entitlement || entitlement.state !== 'ACTIVE' || person.active !== true || verdict.reason === 'Access expired';
  if (ended) return <Box title="This pass is no longer valid">{verdict.reason ?? 'It was cancelled.'} Ask your host if you still need to come in.</Box>;

  const qr = await QRCode.toString(token, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return (
    <main className="mx-auto w-full max-w-md px-4 py-6 text-[#1B2A38]">
      <section className="overflow-hidden rounded-[22px] border border-[#D5DDE4] bg-[#F7F9FB] shadow-sm">
        <header className="flex items-center gap-3 border-b-[3px] border-[#DB3B51] bg-gradient-to-r from-[#004180] to-[#0D5B7A] px-5 py-3 text-white">
          <div>
            <h1 className="text-sm font-bold tracking-[.12em]">{person.profileType === 'visitor' ? 'EDC VISITOR PASS' : person.profileType === 'event_guest' ? 'EDC EVENT PASS' : 'EDC ENTRY PASS'}</h1>
            <p className="text-[11px] uppercase tracking-[.06em] opacity-85">IIM Jammu · EDC</p>
          </div>
          {person.vvip === true && <span className="ml-auto rounded bg-purple-200 px-2 py-0.5 text-xs font-extrabold text-purple-950">VVIP</span>}
        </header>
        <div className="flex flex-col items-center gap-3 px-5 py-5 text-center">
          <p className="text-xl font-bold">{person.firstName} {person.lastName}</p>
          {host && <p className="text-sm text-[#46596B]">Visiting {host.firstName} {host.lastName}</p>}
          {person.profileType === 'event_guest' && typeof person.eventName === 'string' && <p className="text-sm text-[#46596B]">{person.eventName}</p>}
          <div className="w-64 max-w-full rounded-xl bg-white p-3" role="img" aria-label="Pass QR code" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="font-mono text-2xl font-bold tracking-widest" data-testid="visitor-code">{accessCodeFor(person.profileType, person.accessNumber)}</p>
          <p className="text-sm">{windowSummary(entitlement!)}</p>
          <p className={`text-sm font-semibold ${verdict.allowed ? 'text-emerald-700' : 'text-amber-800'}`}>
            {verdict.allowed ? 'Valid now — show this at the gate.' : `Not valid right now: ${verdict.reason}.`}
          </p>
        </div>
      </section>
      <a href={`/print/pass?t=${encodeURIComponent(token)}`} className="mt-4 flex min-h-11 items-center justify-center rounded-lg border border-[#0D5B7A] text-sm font-semibold text-[#0D5B7A]">Print as an ID card / save PDF</a>
      <p className="mt-3 text-center text-xs text-gray-500">Keep this link to yourself — it works as your pass until it ends.</p>
    </main>
  );
}
