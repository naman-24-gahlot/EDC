import QRCode from 'qrcode';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePageRole } from '@/lib/session';
import { nowInIST } from '@/lib/date';
import { loadPerson } from '@/lib/hierarchy/authorize';
import { accessCodeFor } from '@/lib/access/codes';
import { effectiveStatus, getCurrentEntitlement } from '@/lib/access/entitlements';
import { decideAccess } from '@/lib/access/evaluate';
import { passTokenFor } from '@/lib/access/credential';
import { LogoutButton } from '@/components/LogoutButton';
import { PassQr } from './PassQr';
import { fetchedAtNow } from '@/lib/paging';
import { DataStamp } from '@/components/DataStamp';
import { PROFILE_LABEL, STATUS_STYLE, accessStatus, daysLabel, formatDate } from '@/lib/display';
import { holidayOn } from '@/lib/holidays';

export const dynamic = 'force-dynamic';

export default async function PassPage() {
  const user = await requirePageRole('member', 'master');
  const [person, entitlement] = await Promise.all([loadPerson(user.personId), getCurrentEntitlement(user.personId)]);
  if (!person) redirect('/login');

  const now = nowInIST();
  const effective = entitlement ? effectiveStatus(entitlement, now.date) : null;

  const status = accessStatus(person, effective);

  // The pass describes the entitlement; this line is the live time-of-day verdict from the
  // single evaluator, so the person sees exactly what the gate would say right now.
  const verdict = decideAccess(person, entitlement, now, await holidayOn(now.date));
  const accessCode = accessCodeFor(person.profileType, person.accessNumber);
  const showQr = status === 'ACTIVE';
  const qrSvg = showQr
    ? await QRCode.toString(passTokenFor(person), { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
    : null;
  const period = entitlement && effective !== 'SUPERSEDED' ? entitlement : null;
  const name = `${person.firstName} ${person.lastName}`;
  const photo = typeof person.photoDataUrl === 'string' ? person.photoDataUrl : null;

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6 font-sans text-[#1B2A38]">
      <div className="mb-4 flex items-center justify-between">
        <Link href="/me" className="inline-flex min-h-10 items-center md:min-h-0 text-sm font-semibold text-[#0D5B7A]">← My account</Link>
        <LogoutButton />
      </div>
      <div className="mb-3"><DataStamp fetchedAt={fetchedAtNow()} /></div>

      <section className="overflow-hidden rounded-[22px] border border-[#D5DDE4] bg-[#F7F9FB] shadow-[0_4px_16px_rgba(10,40,60,.10),0_1px_3px_rgba(10,40,60,.07)]">
        <header className="flex items-center gap-3 border-b-[3px] border-[#DB3B51] bg-gradient-to-r from-[#004180] to-[#0D5B7A] px-5 py-3 text-white">
          <div>
            <h1 className="text-sm font-bold tracking-[.12em]">EDC ENTRY PASS</h1>
            <p className="text-[11px] uppercase tracking-[.06em] opacity-85">IIM Jammu · EDC</p>
          </div>
          <span className="ml-auto h-2.5 w-2.5 rounded-full bg-[#DB3B51]" aria-hidden />
        </header>

        <div className="flex flex-col items-center gap-4 px-5 py-5 text-center">
          <div className="flex flex-col items-center gap-2">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element -- data: URL from the person doc, not a static/remote asset
              <img src={photo} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-white" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#DCEAF1] text-lg font-semibold text-[#0D5B7A]">
                {person.firstName[0]}{person.lastName[0]}
              </div>
            )}
            <p className="text-[19px] font-bold tracking-tight">{name}</p>
            {person.profileType && (
              <span className="rounded-full bg-[#DCEAF1] px-2.5 py-0.5 text-xs font-semibold text-[#0D5B7A]">
                {PROFILE_LABEL[person.profileType]}
              </span>
            )}
          </div>

          <span className={`rounded-full px-4 py-1.5 text-sm font-bold tracking-wide ring-1 ${STATUS_STYLE[status]}`} data-testid="pass-status">
            {status}
          </span>

          {qrSvg ? (
            <PassQr svg={qrSvg} code={accessCode} name={name} />
          ) : (
            <p className="max-w-xs text-sm text-[#46596B]">
              {status === 'PENDING APPROVAL' && 'Your registration is waiting for approval. Your pass appears here once it is approved and access is granted.'}
              {status === 'NONE' && 'You don’t have access right now. Ask your approver for an access period.'}
              {status === 'EXPIRED' && `Your access ended on ${period?.endDate ? formatDate(period.endDate) : '—'}. Request a new period.`}
              {status === 'REVOKED' && 'An administrator ended your access period. You can send a new access request from your account.'}
              {status === 'DEACTIVATED' && 'Your account is switched off. Contact the EDC office.'}
              {status === 'NOT YET ACTIVE' && `Your access starts on ${period ? formatDate(period.startDate) : '—'}. Your QR appears here then.`}
            </p>
          )}

          <div className="font-mono text-[30px] font-semibold leading-none tracking-[.18em]" data-testid="pass-code">
            <small className="mb-1.5 block font-sans text-[11px] font-semibold uppercase tracking-[.08em] text-[#7C8C9B]">Access code</small>
            {accessCode ?? '— — — —'}
          </div>

          <dl className="grid w-full grid-cols-3 gap-2 border-t border-dashed border-[#C0CBD5] pt-3.5 text-left">
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#7C8C9B]">Valid till</dt>
              <dd className="text-[13px] font-semibold">{period ? (period.endDate ? formatDate(period.endDate) : 'Open-ended') : '—'}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#7C8C9B]">Days</dt>
              <dd className="text-[13px] font-semibold">{period ? daysLabel(period.weekdays) : '—'}</dd>
            </div>
            <div>
              <dt className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-[#7C8C9B]">Hours</dt>
              <dd className="text-[13px] font-semibold">{period ? `${period.startTime}–${period.endTime}` : '—'}</dd>
            </div>
          </dl>

          {showQr && !verdict.allowed && (
            <p className="text-xs text-[#46596B]">Right now: {verdict.reason?.toLowerCase()} — the gate will let you in during your permitted days and hours.</p>
          )}
        </div>

        <footer className="border-t border-[#D5DDE4] bg-[#EEF2F5] px-5 py-2.5 text-center text-[11px] text-[#7C8C9B]">
          Present this pass at the gate.
        </footer>
      </section>
    </main>
  );
}
