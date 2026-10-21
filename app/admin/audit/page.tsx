import Link from 'next/link';
import type { Query, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { formatDateTime } from '@/lib/display';
import { PAGE_SIZE, fetchedAtNow, parsePage } from '@/lib/paging';
import { Pager } from '@/components/Pager';
import { DataStamp } from '@/components/DataStamp';
import { namesFor, requireMasterPage } from '../data';

export const dynamic = 'force-dynamic';

const ID_RE = /^[A-Za-z0-9]{1,128}$/;
// Every action the app writes (DATABASE_SCHEMA.md), so the filter works on any page.
const ACTIONS = [
  'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_CREATED', 'ACCESS_REQUEST_EXPIRED', 'ACCESS_REQUEST_REJECTED',
  'CREDENTIAL_REISSUED', 'ENTITLEMENT_CHANGED', 'ENTITLEMENT_CREATED', 'ENTITLEMENT_REVOKED', 'ENTITLEMENT_SUPERSEDED',
  'ENTRY_APPROVED', 'ENTRY_DENIED', 'GUARD_CREATED', 'HIERARCHY_CHANGED', 'MASTER_DEMOTED', 'MASTER_PROMOTED',
  'ORPHAN_AUTH_ACCOUNT_REMOVED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'PERSON_DEACTIVATED', 'PERSON_REACTIVATED',
  'PROFILE_CREATED', 'PROFILE_TYPE_CHANGED', 'PROFILE_UPDATED', 'REGISTRATION_APPROVED', 'REGISTRATION_REJECTED',
  'REGISTRATION_SUBMITTED', 'SESSIONS_REVOKED',
];

function actionStyle(action: string): string {
  if (/REJECTED|REVOKED|DENIED|DEACTIVATED|DEMOTED/.test(action)) return 'bg-red-100 text-red-800';
  if (/APPROVED|CREATED|REACTIVATED|PROMOTED/.test(action)) return 'bg-green-100 text-green-800';
  if (/EXPIRED|SUPERSEDED|REISSUED|RESET/.test(action)) return 'bg-amber-100 text-amber-800';
  return 'bg-gray-100 text-gray-700';
}

interface AuditRow {
  id: string;
  action: string;
  actorId: string;
  actorRole: string;
  targetPersonId: string | null;
  subjectId: string | null;
  details: string | null;
  timestamp: Timestamp;
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; person?: string; page?: string }> }) {
  await requireMasterPage();
  const params = await searchParams;
  const action = params.action && ACTIONS.includes(params.action) ? params.action : null;
  const person = params.person && ID_RE.test(params.person) ? params.person : null;
  const page = parsePage(params.page);

  // Paged in Firestore (indexes in firestore.indexes.json). Person filter wins over action.
  let base: Query = adminDb.collection('auditLogs');
  if (person) base = base.where('targetPersonId', '==', person);
  else if (action) base = base.where('action', '==', action);
  base = base.orderBy('timestamp', 'desc');
  const [countSnap, snap] = await Promise.all([
    base.count().get(),
    base.offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).get(),
  ]);
  const total = countSnap.data().count;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = snap.docs.map((d) => ({ ...(d.data() as Omit<AuditRow, 'id'>), id: d.id }));
  const names = await namesFor([person, ...rows.map((r) => r.actorId), ...rows.map((r) => r.targetPersonId)]);
  const who = (id: string | null) => (!id ? '—' : id === 'system' || id === 'public' ? id : names.get(id) ?? id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-gray-500">
          Audit log{person && <> for <span className="text-gray-900">{names.get(person) ?? 'this person'}</span> · <Link href="/admin/audit" className="underline">show everyone</Link></>}
        </h2>
        <a href="/api/admin/export/audit" download className="inline-flex min-h-9 items-center rounded border border-gray-300 px-3 text-xs font-medium">Download CSV</a>
        {!person && (
          <form className="flex w-full gap-1 sm:ml-auto sm:w-auto">
            <select name="action" defaultValue={action ?? ''} aria-label="Filter by action" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs">
              <option value="">All actions</option>
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <button className="min-h-9 rounded bg-gray-900 px-3 text-xs text-white">Filter</button>
          </form>
        )}
      </div>
      <DataStamp fetchedAt={fetchedAtNow()} />
      {rows.length === 0 ? <p className="text-sm text-gray-400">No activity.</p> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="rtable w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">By</th>
                <th className="px-3 py-2">Person</th>
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
