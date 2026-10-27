import type { Metadata } from 'next';
import Link from 'next/link';
import { eventByToken, eventOptions, linkState, parseSource } from '@/lib/events';
import { formatDate, formatDateTime } from '@/lib/display';
import { RegisterForm } from '@/app/register/RegisterForm';
import { QuickRegister } from './QuickRegister';

export const dynamic = 'force-dynamic';
// Event links are shared by hand; keep them out of search engines.
export const metadata: Metadata = { robots: { index: false, follow: false } };

type Params = { utm_source?: string; utm_medium?: string; utm_campaign?: string };

// Public: an event's own registration page. Works only while the link is open (lib/events.ts);
// /api/register checks again on submit, so a page left open past the deadline can't sneak in.
export default async function EventRegistrationPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Params> }) {
  const { token } = await params;
  const event = await eventByToken(token);
  const state = event ? linkState(event) : null;

  if (!event || state !== 'OPEN') {
    return (
      <main className="mx-auto w-full max-w-sm space-y-3 px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">{event ? `Registration for ${event.name} is closed` : 'This link doesn’t work'}</h1>
        <p className="text-sm text-gray-500">
          {!event ? 'It may have been mistyped, or replaced with a new link. Ask whoever shared it for the current one.'
            : state === 'EXPIRED' ? `The registration link stopped working on ${formatDateTime(event.linkExpiresAt.toDate())}.`
            : 'The organisers have closed registration.'}
        </p>
        <p className="text-sm">Already have an EDC account? <Link href="/login" className="underline">Sign in</Link></p>
      </main>
    );
  }

  const q = await searchParams;
  const opts = eventOptions(event);
  const source = parseSource({ source: q.utm_source, medium: q.utm_medium, campaign: q.utm_campaign });
  const header = (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#0D5B7A]">Event registration · EDC</p>
      <h1 className="text-2xl font-bold" data-testid="event-name">{event.name}</h1>
      {event.details && <p className="whitespace-pre-line text-sm text-gray-700">{event.details}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
        <dt className="text-gray-500">When</dt>
        <dd>{event.accessFrom === event.accessTo ? formatDate(event.accessFrom) : `${formatDate(event.accessFrom)} – ${formatDate(event.accessTo)}`}, {event.gateOpens}–{event.gateCloses}</dd>
        {event.venue && <><dt className="text-gray-500">Where</dt><dd>{event.venue}</dd></>}
        <dt className="text-gray-500">Register by</dt>
        <dd>{formatDateTime(event.linkExpiresAt.toDate())}</dd>
      </dl>
      {!opts.requirePassword ? (
        <p className="text-sm text-gray-500">{opts.autoApprove ? 'Fill this in and get your entry pass straight away' : 'Fill this in; once approved you get your entry pass'}{opts.emailPass ? ' (also by email, if you give one)' : ''}. No account or password needed.</p>
      ) : <p className="text-sm text-gray-500">
        Fill this in once. After approval you can sign in and show your entry pass at the gate during the event.
        Already have an EDC account? You don&apos;t need to register again — <Link href="/login" className="underline">sign in</Link> and send an access request for this event.
      </p>}
    </div>
  );

  const sourceTags = { ...(source.source ? { source: source.source } : {}), ...(source.medium ? { medium: source.medium } : {}), ...(source.campaign ? { campaign: source.campaign } : {}) };
  if (!opts.requirePassword) {
    return <QuickRegister token={token} source={sourceTags} emailPass={opts.emailPass} autoApprove={opts.autoApprove} kiosk={opts.kiosk} kioskNext={opts.kioskNext} kioskSeconds={opts.kioskSeconds} header={header} />;
  }
  return (
    <RegisterForm header={header} event={{
      token, name: event.name,
      source: { ...(source.source ? { source: source.source } : {}), ...(source.medium ? { medium: source.medium } : {}), ...(source.campaign ? { campaign: source.campaign } : {}) },
    }} />
  );
}
