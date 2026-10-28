import Link from 'next/link';
import type { Timestamp } from 'firebase-admin/firestore';
import { ACTION_GROUPS, auditQuery, filterParams, parseAuditFilter, runPaged } from '@/lib/logs';
import { AuditFilterForm } from './AuditFilterForm';
import { listEvents } from '@/lib/events';
import { formatDateTime } from '@/lib/display';
import { PAGE_SIZE, fetchedAtNow, parsePage } from '@/lib/paging';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { namesFor, requireMasterPage } from '../data';
import { sealAll, verifyChain } from '@/lib/auditChain';
import { InfoTip } from '@/components/InfoTip';

export const dynamic = 'force-dynamic';

function actionStyle(action: string): string {
  if (/REJECTED|REVOKED|DENIED|DEACTIVATED|DEMOTED/.test(action)) return 'bg-red-100 text-red-800';
  if (/APPROVED|CREATED|REACTIVATED|PROMOTED/.test(action)) return 'bg-green-100 text-green-800';
  if (/EXPIRED|SUPERSEDED|REISSUED|RESET/.test(action)) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

interface AuditRow {
  eventId?: string | null;
  id: string;
  action: string;
  actorId: string;
  actorRole: string;
  targetPersonId: string | null;
  subjectId: string | null;
  details: string | null;
  timestamp: Timestamp;
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireMasterPage();
  const params = await searchParams;
  const filter = parseAuditFilter(params);
  const person = filter.person;
  const page = parsePage(params.page);

  // Anything not yet sealed into the chain is sealed before it's shown (lib/auditChain.ts).
  await sealAll();
  // "Check integrity" checks what was sealed since the last good check; "Full check" re-reads everything.
  const check = params.verify === '1' || params.verify === 'full' ? await verifyChain({ full: params.verify === 'full' }) : null;

  // Paged in Firestore (lib/logs.ts; indexes in firestore.indexes.json).
  const base = auditQuery(filter);
  const [{ building, total, docs }, events] = await Promise.all([runPaged(base, page, PAGE_SIZE, filter.order), listEvents()]);
  const eventName = new Map(events.map((e) => [e.id, e.name]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = docs.map((d) => ({ ...(d.data() as Omit<AuditRow, 'id'>), id: d.id }));
  const names = await namesFor([person, ...rows.map((r) => r.actorId), ...rows.map((r) => r.targetPersonId)]);
  const who = (id: string | null) => (!id ? '—' : id === 'system' || id === 'public' ? id : names.get(id) ?? id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-gray-500">
          Audit log{person && <> for <span className="text-gray-900">{names.get(person) ?? 'this person'}</span> · <Link href="/admin/audit" className="underline">show everyone</Link></>}
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="chain">
        <span className="inline-flex items-center gap-1 text-gray-500">
          Tamper-evident log
          <InfoTip label="About the tamper-evident log">Every entry is numbered and carries a fingerprint of itself plus the entry before it, made with a server-only key. If anyone edits, deletes or reorders an entry in the database, the chain breaks at that point. “Check integrity” checks the entries added since the last good check; “Full check” re-checks every entry from the first (it reads the whole log, so use it when you need it, not every visit).</InfoTip>
        </span>
        {check ? (check.broken
          ? <span className="rounded bg-red-100 px-2 py-1 font-semibold text-red-800" role="alert" data-testid="chain-broken">Chain broken at entry #{check.broken.seq}{check.broken.entryId ? ` (${check.broken.entryId})` : ''}: {check.broken.problem}. {check.from + check.checked} entries before it are intact.</span>
          : <span className="rounded bg-emerald-100 px-2 py-1 font-semibold text-emerald-800" role="status" data-testid="chain-ok">✓ {check.from > 0 ? <>{check.checked} new {check.checked === 1 ? 'entry' : 'entries'} checked — all {check.headSeq} intact (#1–{check.from} at earlier checks)</> : <>All {check.checked} entries intact</>}{check.redacted ? ` (${check.redacted} blanked by account deletions)` : ''}{check.unsealed ? ` (${check.unsealed} just written, not sealed yet)` : ''}.</span>)
          : <>
            <Link href={{ pathname: '/admin/audit', query: { ...filterParams(filter), verify: '1' } }} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-2 font-medium md:min-h-7">Check integrity</Link>
            <Link href={{ pathname: '/admin/audit', query: { ...filterParams(filter), verify: 'full' } }} className="inline-flex min-h-10 items-center rounded border border-gray-300 px-2 font-medium md:min-h-7">Full check</Link>
          </>}
      </div>
      <AuditFilterForm key={JSON.stringify(filter)} groups={ACTION_GROUPS} selected={filter.actions} from={filter.from} to={filter.to} order={filter.order} person={person}
        event={filter.event} events={events.map((e) => ({ id: e.id, name: e.name }))} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">{total} matching {total === 1 ? 'entry' : 'entries'}</p>
        <DataStamp fetchedAt={fetchedAtNow()} pageParams={['page']} />
      </div>
      {building ? <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">This combination of filters is still being prepared by the database (a few minutes after an update). Try again shortly, or change a filter.</p> : rows.length === 0 ? <p className="text-sm text-gray-400">Nothing matches these filters.</p> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="rtable w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((l) => (
                <tr key={l.id}>
                  <td data-label="When" className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{formatDateTime(l.timestamp.toDate())}</td>
                  <td data-label="Action" className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${actionStyle(l.action)}`}>{l.action}</span></td>
                  <td data-label="By" className="px-3 py-2 text-xs">{who(l.actorId)} <span className="text-gray-400">({l.actorRole})</span></td>
                  <td data-label="Person" className="px-3 py-2 text-xs">{l.targetPersonId ? <Link href={`/admin/people/${l.targetPersonId}`} className="hover:underline">{who(l.targetPersonId)}</Link> : '—'}</td>
                  <td data-label="Event" className="px-3 py-2 text-xs">{l.eventId && eventName.has(l.eventId) ? <Link href={`/admin/events/${l.eventId}`} className="underline">{eventName.get(l.eventId)}</Link> : <span className="text-gray-400">—</span>}</td>
                  <td data-label="Details" className="px-3 py-2 text-xs text-gray-600">{l.details ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={Math.min(page, pages)} pages={pages} total={total} noun="entries" />
    </div>
  );
}
