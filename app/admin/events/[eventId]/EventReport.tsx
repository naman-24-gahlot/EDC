import Link from 'next/link';
import type { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { PersonRecord } from '@/lib/hierarchy/authorize';
import { eventTiming, type EventRecord } from '@/lib/events';
import { nowInIST } from '@/lib/date';
import { formatDate } from '@/lib/display';
import { durationText } from '@/lib/stays';

const PHASE = { upcoming: 'Before the event', ongoing: 'During the event', past: 'After the event' } as const;
const istDay = (ts: Timestamp) => nowInIST(ts.toDate()).date;
const istHour = (ts: Timestamp) => nowInIST(ts.toDate()).time.slice(0, 2);

function Bars({ rows, unit }: { rows: [string, number][]; unit: string }) {
  const max = Math.max(1, ...rows.map(([, n]) => n));
  return (
    <ul className="space-y-1 text-xs">
      {rows.map(([k, n]) => (
        <li key={k} className="grid grid-cols-[5.5rem_1fr_2.5rem] items-center gap-2">
          <span className="text-gray-600">{k}</span>
          <span className="h-3 rounded bg-gray-100"><span className="block h-3 rounded bg-[#0D5B7A]" style={{ width: `${(n / max) * 100}%` }} /></span>
          <span className="text-right tabular-nums" aria-label={`${n} ${unit}`}>{n}</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

// Before / during / after numbers for one event, from its registrations (people.eventId) and its
// gate records (entryEvents.eventId). Computed on each visit — nothing extra is stored.
export async function EventReport({ event, people }: { event: EventRecord; people: PersonRecord[] }) {
  const snap = await adminDb.collection('entryEvents').where('eventId', '==', event.id).get();
  const entries = snap.docs.map((d) => d.data() as { personId: string | null; result: string; reason: string | null; timestamp: Timestamp; stayMinutes?: number | null });
  const phase = eventTiming(event);

  const approved = people.filter((p) => p.registrationStatus === 'APPROVED');
  const arrivedIds = new Set(entries.filter((e) => e.result === 'APPROVED' && e.personId).map((e) => e.personId!));
  const arrived = approved.filter((p) => arrivedIds.has(p.personId));
  const noShows = approved.filter((p) => !arrivedIds.has(p.personId));
  const insideNow = people.filter((p) => p.onCampus === true).length;
  const rate = approved.length ? Math.round((arrived.length / approved.length) * 100) : 0;

  const signupsByDay = new Map<string, number>();
  for (const p of people) { const ts = p.createdAt as Timestamp | undefined; if (ts) signupsByDay.set(istDay(ts), (signupsByDay.get(istDay(ts)) ?? 0) + 1); }
  const arrivalsByHour = new Map<string, number>();
  const firstIn = new Map<string, Timestamp>();
  for (const e of entries) if (e.result === 'APPROVED' && e.personId && (!firstIn.has(e.personId) || e.timestamp.toMillis() < firstIn.get(e.personId)!.toMillis())) firstIn.set(e.personId, e.timestamp);
  for (const ts of firstIn.values()) arrivalsByHour.set(`${istHour(ts)}:00`, (arrivalsByHour.get(`${istHour(ts)}:00`) ?? 0) + 1);
  const stays = entries.map((e) => e.stayMinutes).filter((m): m is number => typeof m === 'number' && m >= 0).sort((a, b) => a - b);
  const median = stays.length ? stays[Math.floor(stays.length / 2)] : null;
  const denied = new Map<string, number>();
  for (const e of entries) if (e.result === 'DENIED') denied.set(e.reason ?? 'Unknown', (denied.get(e.reason ?? 'Unknown') ?? 0) + 1);

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4" data-testid="event-report">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Event report <span className="ml-1 rounded bg-white px-1.5 py-0.5 text-xs font-normal ring-1 ring-gray-200">{PHASE[phase]}</span></h3>
        <span className="text-xs"><Link href={`/admin/entries?event=${event.id}`} className="underline">Gate records</Link> · <Link href={`/admin/audit?event=${event.id}`} className="underline">Audit log</Link></span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Registered" value={people.length} sub={`${approved.length} approved`} />
        <Stat label="Arrived" value={arrived.length} sub={approved.length ? `${rate}% of approved` : undefined} />
        <Stat label="Inside now" value={insideNow} />
        <Stat label="Typical stay" value={median === null ? '—' : durationText(median)} sub={stays.length ? `median of ${stays.length} exits` : 'no exits recorded yet'} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <h4 className="text-xs font-semibold uppercase text-gray-500">Sign-ups by day</h4>
          {signupsByDay.size ? <Bars unit="sign-ups" rows={[...signupsByDay].sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => [formatDate(d), n])} /> : <p className="text-xs text-gray-400">None yet.</p>}
        </div>
        <div className="space-y-1">
          <h4 className="text-xs font-semibold uppercase text-gray-500">Arrivals by hour (first entry)</h4>
          {arrivalsByHour.size ? <Bars unit="arrivals" rows={[...arrivalsByHour].sort((a, b) => a[0].localeCompare(b[0]))} /> : <p className="text-xs text-gray-400">Nobody has arrived yet.</p>}
        </div>
      </div>
      {denied.size > 0 && (
        <p className="text-xs text-gray-600"><b>Turned away at the gate:</b> {[...denied].map(([r, n]) => `${r} ×${n}`).join(' · ')}</p>
      )}
      {phase !== 'upcoming' && noShows.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold">{noShows.length} approved but didn’t come</summary>
          <ul className="mt-1 columns-1 text-xs sm:columns-2">{noShows.slice(0, 100).map((p) => <li key={p.personId}><Link href={`/admin/people/${p.personId}`} className="underline">{p.firstName} {p.lastName}</Link></li>)}</ul>
        </details>
      )}
    </section>
  );
}
