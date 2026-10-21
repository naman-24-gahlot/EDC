import Link from 'next/link';
import type { Query, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { formatDateTime } from '@/lib/display';
import { PAGE_SIZE, fetchedAtNow, parsePage } from '@/lib/paging';
import { StatusPill } from '@/components/StatusPill';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { namesFor, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9]{1,128}$/;

interface EntryRow {
  id: string;
  personId: string | null;
  guardUid: string;
  method: string;
  result: string;
  reason: string | null;
  presentedCode: string | null;
  timestamp: Timestamp;
}

export default async function AdminEntriesPage({ searchParams }: { searchParams: Promise<{ page?: string; person?: string }> }) {
  await requireMasterPage();
  const params = await searchParams;
  const person = params.person && ID_RE.test(params.person) ? params.person : null;
  const page = parsePage(params.page);

  // Paged in Firestore: only this page's rows are read (plus a count, billed per 1,000 entries).
  let base: Query = adminDb.collection('entryEvents');
  if (person) base = base.where('personId', '==', person);
  base = base.orderBy('timestamp', 'desc');
  const [countSnap, snap] = await Promise.all([
    base.count().get(),
    base.offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).get(),
  ]);
  const total = countSnap.data().count;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = snap.docs.map((d) => ({ ...(d.data() as Omit<EntryRow, 'id'>), id: d.id }));
  const names = await namesFor([person, ...rows.map((r) => r.personId), ...rows.map((r) => r.guardUid)]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-500">
          Gate entries{person && <> for <span className="text-gray-900">{names.get(person) ?? 'this person'}</span> · <Link href="/admin/entries" className="underline">show everyone</Link></>}
        </h2>
        <a href="/api/admin/export/entries" download className="inline-flex min-h-9 items-center rounded border border-gray-300 px-3 text-xs font-medium">Download CSV</a>
      </div>
      <DataStamp fetchedAt={fetchedAtNow()} />
      {rows.length === 0 ? <p className="text-sm text-gray-400">No gate activity{person ? ' for this person' : ''} yet.</p> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="rtable w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2">Guard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td data-label="When" className="whitespace-nowrap px-3 py-2 text-xs text-gray-500">{formatDateTime(e.timestamp.toDate())}</td>
                  <td data-label="Person" className="px-3 py-2">
                    {e.personId ? <Link href={`/admin/people/${e.personId}`} className="hover:underline">{names.get(e.personId) ?? e.personId}</Link> : <span className="text-gray-400">unresolved</span>}
                  </td>
                  <td data-label="Method" className="px-3 py-2 text-xs">{e.method}{e.presentedCode ? <span className="font-mono"> {e.presentedCode}</span> : ''}</td>
                  <td data-label="Result" className="px-3 py-2"><StatusPill status={e.result} /></td>
                  <td data-label="Reason" className="px-3 py-2 text-xs">{e.reason ?? '—'}</td>
                  <td data-label="Guard" className="px-3 py-2 text-xs text-gray-500">{names.get(e.guardUid) ?? e.guardUid}</td>
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
